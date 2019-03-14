'use strict';

module.exports.Storage = class Storage {
    constructor() {
        this.state = {};
    }

    getBucket() {
        return {
            getFiles: async ({ prefix }) =>
                this.state.getFiles && this.state.getFiles[prefix],

            async getMetadata() {
                return {};
            },

            file: fileName => ({
                name: fileName,
                createWriteStream: () => this.state.createWriteStream,
                save: async () => this.state.save,
                download: async () =>
                    this.state.download && this.state.download[fileName],
                exists: async () => this.state.exists,
                move: async () => this.state.move,
            }),
        };
    }

    _setState(newState) {
        this.state = newState;
    }

    bucket(bucketName) {
        return this.getBucket(bucketName);
    }
};

module.exports.mustateStore = () => {};
