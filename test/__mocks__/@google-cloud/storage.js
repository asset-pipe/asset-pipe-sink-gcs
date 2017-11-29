'use strict';

module.exports = () => {
    let state = {};

    const getBucket = () => ({
        async getFiles({ prefix }) {
            return state.getFiles && state.getFiles[prefix];
        },

        async getMetadata() {
            return {};
        },

        file(fileName) {
            return {
                name: fileName,
                createWriteStream() {
                    return state.createWriteStream;
                },
                async save() {
                    return state.save;
                },
                async download() {
                    return state.download && state.download[fileName];
                },
                async exists() {
                    return state.exists;
                },
                async move() {
                    return state.move;
                },
            };
        },
    });

    return {
        _setState(newState) {
            state = newState;
        },
        bucket(bucketName) {
            return getBucket(bucketName);
        },
    };
};

module.exports.mustateStore = () => {};
