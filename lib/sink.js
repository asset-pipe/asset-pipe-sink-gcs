'use strict';

const EventEmitter = require('events');
const JSONStream = require('JSONStream');
const gcsClient = require('@google-cloud/storage');
const isObject = require('lodash.isobject');
const isString = require('lodash.isstring');
const common = require('asset-pipe-common');
const stream = require('readable-stream');
const assert = require('assert');
const extname = require('ext-name');

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

        const gcsStream = gcsFile.createWriteStream(
            Object.assign(
                {},
                {
                    metadata: {
                        contentType: extname(type)[0] && extname(type)[0].mime,
                    },
                },
                options
            )
        );

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

        gcsStream.on('error', () => {
            this.emit('file not found', fileName);
        });

        gcsStream.pipe(this);
    }
}

module.exports = class SinkGCS extends EventEmitter {
    constructor(options, bucketName, metadata = {}) {
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

        this._ready = this.gcs
            .createBucket(bucketName, metadata)
            .then(bucketObj => {
                this.bucket = bucketObj;
                this.emit(
                    'storage info',
                    `Bucket "${bucketName}" did not exist. Created bucket`
                );
                return this.bucket;
            })
            .catch(error => {
                this.bucket = this.gcs.bucket(bucketName);
                this.emit(
                    'storage info',
                    `Bucket "${bucketName}" exists. Using bucket`,
                    error
                );
                return this.bucket;
            });
    }

    _getGcsFile(fileName) {
        return this.gcs.bucket(this.bucketName).file(fileName);
    }

    async get(fileName) {
        await this._ready;
        const data = await this._getGcsFile(fileName).download();
        return data.toString();
    }

    async set(fileName, fileContent) {
        assert(fileName, '"fileName" is missing');
        assert(fileContent, '"fileContent" is missing');
        await this._ready;
        await this._getGcsFile(fileName).save(fileContent);
    }

    async has(fileName) {
        assert(fileName, '"fileName" is missing');
        await this._ready;
        const result = await this._getGcsFile(fileName).exists();
        return !!(result && result[0]);
    }

    writer(type) {
        assert(type, '"type" is missing');
        const fileName = common.createTemporaryFilename(type);
        return new WriteStream(this._getGcsFile(fileName), type, this.options);
    }

    reader(fileName) {
        assert(fileName, '"fileName" is missing');
        return new ReadStream(
            this._getGcsFile(fileName),
            fileName,
            this.options
        );
    }
};
