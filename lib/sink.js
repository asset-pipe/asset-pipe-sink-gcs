'use strict';

const EventEmitter = require('events');
const JSONStream = require('JSONStream');
const gcsClient = require('@google-cloud/storage');
const isObject = require('lodash.isobject');
const isString = require('lodash.isstring');
const common = require('@asset-pipe/common');
const stream = require('readable-stream');
const assert = require('assert');
const VError = require('verror');
const mime = require('mime-types');
const { dirname, extname } = require('path');
const pRetry = require('p-retry');
const Boom = require('boom');

/**
 * Check and wrap an assumed error object.
 *
 * The gcs client emit error objects which are not real error objects. They are plain objects
 * with error like characteristics. Wrap these in proper error object to align the sinks.
 *
 * @param {error} error An assumed error object
 */

const wrapError = error => {
    if (error instanceof Error) {
        return error;
    }
    const err = new Error();
    if (error.message) {
        err.message = error.message;
    }
    if (error.errors) {
        err.data = error.errors;
    }
    return err;
};

class WriteStream extends stream.PassThrough {
    constructor(gcsFile, type, options) {
        super();
        const hasher =
            type === 'json' ? new common.IdHasher() : new common.FileHasher();
        const parser =
            type === 'json' ? JSONStream.parse('*') : new stream.PassThrough();

        const gcsStream = gcsFile.createWriteStream({
            ...options,
            ...{
                metadata: {
                    contentType: mime.lookup(type),
                    ...options.metadata,
                },
            },
        });

        gcsStream.on('finish', async () => {
            const id = hasher.hash;
            const fileName = `${id}.${type}`;
            try {
                await gcsFile.move(fileName);
                this.emit('file saved', id, fileName);
            } catch (e) {
                this.emit('file not saved', wrapError(e));
            }
        });

        hasher.on('error', error => {
            this.emit('error', wrapError(error));
        });

        parser.on('error', error => {
            this.emit('error', wrapError(error));
        });

        gcsStream.on('error', error => {
            this.emit('error', wrapError(error));
        });

        this.pipe(parser).pipe(hasher);
        this.pipe(gcsStream);
    }
}

class ReadStream extends stream.PassThrough {
    constructor(gcsFile, fileName, options) {
        super();
        const gcsStream = gcsFile.createReadStream(options);

        gcsStream.on('response', () => {
            this.emit('file found', fileName);
        });

        gcsStream.on('error', e => {
            if (e.code === 404) {
                this.emit('file not found', fileName, e);
            } else {
                this.emit('error', e);
            }
        });

        gcsStream.pipe(this);
    }
}

const getGcsFile = Symbol('getGcsFile');
const ready = Symbol('ready');

function getPrefixes(directoryName) {
    let prefix;
    let filterPrefix;
    if (directoryName === '/' || !directoryName) {
        filterPrefix = '.';
    } else {
        prefix = `${directoryName.replace(/^\//, '').replace(/\/$/, '')}/`;
        filterPrefix = prefix;
    }
    return { filterPrefix, prefix };
}

function getPrefixFilterIterator(filterPrefix) {
    return item => {
        const dir = dirname(item.name);
        const nameDirName = dir === '.' || dir === '/' ? '.' : `${dir}/`;
        return nameDirName === filterPrefix;
    };
}

module.exports = class SinkGCS extends EventEmitter {
    constructor(options, bucketName) {
        super();
        assert(
            options && isObject(options),
            '"options" object must be provided'
        );
        assert(
            bucketName && isString(bucketName),
            '"bucket" string must be provided'
        );

        this.options = options;
        this.bucketName = bucketName;
        this.name = 'asset-pipe-sink-gcs';
        this.gcs = gcsClient(options);
        this.bucket = null;

        const bucket = this.gcs.bucket(bucketName);

        // `getMetadata` fails if the bucket does not exist
        this[ready] = bucket
            .getMetadata()
            .then(() => {
                this.bucket = bucket;
                this.emit(
                    'storage info',
                    `Bucket "${bucketName}" exists. Using bucket`
                );
                return this.bucket;
            })
            .catch(error => {
                const wrappedError = wrapError(error);

                if (error.code === 404) {
                    return Promise.reject(
                        new VError(
                            wrappedError,
                            `The bucket "${bucketName}" does not exist`
                        )
                    );
                }

                return Promise.reject(wrappedError);
            });
    }

    [getGcsFile](fileName) {
        return this.gcs.bucket(this.bucketName).file(fileName);
    }

    async get(fileName) {
        await this[ready];
        const file = this[getGcsFile](fileName);
        if (!await file.exists()) {
            throw Boom.notFound(`Unable to find requested file "${fileName}"`, {
                file: fileName,
            });
        }

        try {
            return await pRetry(() => file.download({ validation: false }), {
                retries: 3,
            });
        } catch (err) {
            throw Boom.boomify(err, {
                file: fileName,
                message: `File "${fileName}" exists, however multiple attempts to download the file from google cloud storage has failed.`,
                statusCode: 503,
            });
        }
    }

    async set(fileName, fileContent, options = {}) {
        assert(fileName, 'Expected "fileName" to be provided, none given.');
        assert(
            fileContent,
            'Expected argument "fileContent" to be provided, none given.'
        );
        const ext = extname(fileName);
        assert(
            ext,
            'Expected argument "fileName" to include an extension, none found.'
        );
        const contentType = mime.lookup(ext);
        assert(
            contentType,
            'Expected file extension for argument "fileName" to resolve to a valid mime type. ' +
                `Instead extension "${ext}" resolved to content type "${contentType}"`
        );

        const metadata = { contentType, ...(options.metadata || {}) };

        await this[ready];
        const file = this[getGcsFile](fileName);
        const saveFile = () =>
            file.save(fileContent, {
                metadata,
                resumable: false,
                public: options.public !== false,
            });
        try {
            return await pRetry(saveFile, { retries: 3 });
        } catch (err) {
            throw Boom.boomify(err, {
                file: fileName,
                message: `Unable to save file "${fileName}" to google cloud storage. 3 attempts failed.`,
                statusCode: 503,
            });
        }
    }

    async has(fileName) {
        assert(fileName, '"fileName" is missing');
        await this[ready];
        const result = await this[getGcsFile](fileName).exists({
            validation: false,
        });
        return !!(result && result[0]);
    }

    async dir(directoryName) {
        await this[ready];
        try {
            const { prefix, filterPrefix } = getPrefixes(directoryName);
            const fileRequestResult = await this.bucket.getFiles({
                prefix,
            });

            if (!fileRequestResult) {
                throw new Error();
            }

            const [files] = fileRequestResult;
            if (!files || files.length === 0) {
                throw new Error();
            }
            const result = await Promise.all(
                files.filter(getPrefixFilterIterator(filterPrefix)).map(item =>
                    item.download().then(content => ({
                        fileName: item.name,
                        content: content.toString(),
                    }))
                )
            );
            if (result.length === 0) {
                throw new Error();
            }
            return result;
        } catch (e) {
            throw new Error(
                `Missing folder with name "${directoryName}" or empty result`
            );
        }
    }

    writer(type) {
        assert(type, `Expected argument "type" to be provided to writer`);
        assert(
            mime.lookup(type),
            `Expected type "${type}" to resolve to a valid mime type, instead got "${mime.lookup(
                type
            )}"`
        );
        const fileName = common.createTemporaryFilename(type);
        return new WriteStream(this[getGcsFile](fileName), type, this.options);
    }

    reader(fileName) {
        assert(fileName, '"fileName" is missing');
        return new ReadStream(
            this[getGcsFile](fileName),
            fileName,
            this.options
        );
    }
};
