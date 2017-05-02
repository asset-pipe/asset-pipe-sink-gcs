'use strict';

const EventEmitter = require('events');
const JSONStream = require('JSONStream');
const gcsClient = require('@google-cloud/storage');
const isObject = require('lodash.isobject');
const isString = require('lodash.isstring');
const common = require('asset-pipe-common');
const stream = require('readable-stream');
const assert = require('assert');


/**
 * Check and wrap an assumed error object.
 *
 * The gcs client emit error objects which are not real error objects. They are plain objects
 * with error like characteristics. Wrap these in proper error object to align the sinks.
 *
 * @param {error} error An assumed error object
 */

const wrapError = (error) => {
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
    constructor (gcs, bucket, type, options) {
        super();
        const temp = common.createTemporaryFilename(type);
        const gcsFile = bucket.file(temp);

        const hasher = (type === 'json') ? new common.IdHasher() : new common.FileHasher();
        const parser = (type === 'json') ? JSONStream.parse('*') : new stream.PassThrough();

        const gcsStream = gcsFile.createWriteStream(options);
        gcsStream.on('finish', () => {
            const id = hasher.hash;
            const file = `${id}.${type}`;
            gcsFile.move(file, (error) => {
                if (error) {
                    return this.emit('file not saved', wrapError(error));
                }
                this.emit('file saved', id, file);
            });
        });

        hasher.on('error', (error) => {
            this.emit('error', wrapError(error));
        });

        parser.on('error', (error) => {
            this.emit('error', wrapError(error));
        });

        gcsStream.on('error', (error) => {
            this.emit('error', wrapError(error));
        });

        this.pipe(parser).pipe(hasher);
        this.pipe(gcsStream);
    }
}


class ReadStream extends stream.PassThrough {
    constructor (gcs, bucket, file, options) {
        super();
        const gcsFile = bucket.file(file);
        const gcsStream = gcsFile.createReadStream(options);

        gcsStream.on('response', () => {
            this.emit('file found', file);
        });

        gcsStream.on('error', (error) => {
            this.emit('file not found', file);
        });

        gcsStream.pipe(this);
    }
}


module.exports = class SinkGCS extends EventEmitter {
    constructor (options, bucket, metadata = {}) {
        super();
        assert(options && isObject(options), '"options" object must be provided');
        assert(bucket && isString(bucket), '"bucket" string must be provided');

        this.options = options;
        this.name = 'asset-pipe-sink-gcs';
        this.gcs = gcsClient(options);
        this.bucket = null;

        this.gcs.createBucket(bucket, metadata, (error, bucketObj) => {
            if (error) {
                this.bucket = this.gcs.bucket(bucket);
                return this.emit('storage info', `Bucket "${bucket}" exist. Using bucket`, error);
            }
            this.bucket = bucketObj;
            this.emit('storage info', `Bucket "${bucket}" did not exist. Created bucket`);
        });
    }

    writer (type) {
        assert(type, '"type" is missing');
        return new WriteStream(this.gcs, this.bucket, type, this.options);
    }

    reader (file) {
        assert(file, '"file" is missing');
        return new ReadStream(this.gcs, this.bucket, file, this.options);
    }
};
