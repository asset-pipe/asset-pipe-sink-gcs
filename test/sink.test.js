'use strict';

// const stream = require('readable-stream');
const SinkGCS = require('../');

function getValidSink() {
    return new SinkGCS({}, 'bucket-name');
}

test('constructor() - no value for "options" argument - should throw', () => {
    expect(() => {
        new SinkGCS(); // eslint-disable-line
    }).toThrowError('"options" object must be provided');
});

test('constructor() - no value for "bucket" argument - should throw', () => {
    expect(() => {
        // eslint-disable-next-line no-new
        new SinkGCS({
            projectId: 'asset-pipe',
            keyFilename: './foo.json',
        });
    }).toThrowError('"bucket" string must be provided');
});

test('constructor() - has value for "options" and "bucket" arguments - should be of Sink Class type', () => {
    expect(
        new SinkGCS(
            {
                // eslint-disable-line
                projectId: 'asset-pipe',
                keyFilename: './foo.json',
            },
            'asset-bucket'
        )
    ).toBeInstanceOf(SinkGCS);
});

test('.writer() - no value for "type" argument - should throw', () => {
    const sink = getValidSink();
    expect(() => {
        sink.writer();
    }).toThrowError('"type" is missing');
});
