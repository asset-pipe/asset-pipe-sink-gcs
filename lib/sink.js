"use strict";

const cloudStorage = require('@google-cloud/storage');
const isObject = require('lodash.isobject');
const isString = require('lodash.isstring');
const stream = require('readable-stream');
const assert = require('assert');
const crypto = require('crypto');



const SinkGCS = module.exports = class SinkGCS {
    constructor(options) {
        assert(options && isObject(options), '"options" object must be provided');
        assert(options.projectId && isString(options.projectId), '"options.projectId" must be provided');
        assert(options.keyFilename && isString(options.keyFilename), '"options.keyFilename" must be provided');
        this.options = options;
        this.gcsBucket = 'some-bucket';
    }


    createTempFileName (fileType) {
        const rand = Math.floor(Math.random() * 1000).toString();
        return 'tmp-' + Date.now().toString() + '-' + rand + '.' + fileType;
    }


    writer (fileType, callback) {
        const tempName = this.createTempFileName(fileType);
        const hash = crypto.createHash('sha1');

        const gcs = cloudStorage(this.options);
        const bucket = gcs.bucket(this.gcsBucket);

        const writer = bucket.file(tempName).createWriteStream()
        .on('error', callback)
        .on('finish', () => {
            // TODO: Rename remote file to final name
            const fileName = hash.digest('hex') + '.' + fileType;

            callback(null, filename);
        });

        const hasher = new stream.Transform({
            transform: function (chunk, encoding, next) {
                hash.update(chunk, 'utf8');
                this.push(chunk);
                next();
            }
        });

        hasher.pipe(file);
        return hasher;
    }


    reader (fileName, callback) {
        const gcs = cloudStorage(this.options);
        const bucket = gcs.bucket(this.gcsBucket);

        const reader = bucket.file(fileName).createReadStream()
            .on('error', callback)
            .on('end', () => {
                if (callback) {
                    callback();
                }
            });

        return reader;
    }
};
