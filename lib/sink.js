'use strict';

const JSONStream = require('JSONStream');
const gcsClient = require('@google-cloud/storage');
const isObject = require('lodash.isobject');
const isString = require('lodash.isstring');
const common = require('asset-pipe-common');
const stream = require('readable-stream');
const assert = require('assert');


class WriteStream extends stream.PassThrough {
    constructor (gcs, bucket, type) {
        super();
        const temp = common.createTemporaryFilename(type);
        const gcsBucket = gcs.bucket(bucket);
        const gcsFile = gcsBucket.file(temp);

        const hasher = (type === 'json') ? new common.SourceHasher() : new common.FileHasher();
        const parser = (type === 'json') ? JSONStream.parse('*') : new stream.PassThrough();

        const gcsStream = gcsFile.createWriteStream();
        gcsStream.on('finish', () => {
            const id = hasher.hash;
            const file = `${id}.${type}`;
            gcsFile.move(file, (error) => {
                if (error) {
                    return this.emit('file not saved');
                }
                this.emit('file saved', id, file);
            });
        });

        hasher.on('error', (error) => {
            this.emit('error', error);
        });

        parser.on('error', (error) => {
            this.emit('error', error);
        });

        gcsStream.on('error', (error) => {
            this.emit('error', error);
        });

        this.pipe(parser).pipe(hasher);
        this.pipe(gcsStream);
    }
}


class ReadStream extends stream.PassThrough {
    constructor (gcs, bucket, file) {
        super();
        const gcsBucket = gcs.bucket(bucket);
        const gcsFile = gcsBucket.file(file);
        const gcsStream = gcsFile.createReadStream();

        gcsStream.on('response', () => {
            this.emit('file found');
        });

        gcsStream.on('error', (error) => {
            this.emit('file not found', error);
        });

        gcsStream.pipe(this);
    }
}


module.exports = class SinkGCS {
    constructor (options, bucket) {
        assert(options && isObject(options), '"options" object must be provided');
        assert(bucket && isString(bucket), '"bucket" string must be provided');

        this.bucket = bucket;
        this.gcs = gcsClient(options);
    }

    writer (type) {
        assert(type, '"type" is missing');
        return new WriteStream(this.gcs, this.bucket, type);
    }

    reader (file) {
        assert(file, '"file" is missing');
        return new ReadStream(this.gcs, this.bucket, file);
    }
};
