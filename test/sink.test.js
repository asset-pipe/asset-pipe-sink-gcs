'use strict';

const stream = require('readable-stream');
const SinkGCS = require('../');

function getValidSink() {
    return new SinkGCS(
        { projectId: 'asset-pipe', keyFilename: './foo.json' },
        'bucket-name'
    );
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

test('.writer() - happy path', async done => {
    expect.assertions(2);
    const sink = getValidSink();

    await sink._ready;

    const gcsFakeWritestream = new stream.Writable({
        _data: false,
        write(chunk, encoding, next) {
            this._data += chunk;
            next();
        },
    });

    sink.gcs._setState({
        createWriteStream: gcsFakeWritestream,
        move: null,
    });

    const dest = sink.writer('json');

    const source = require('fs').createReadStream(
        `${__dirname}/mock/feed.a.json`
    );

    source.on('error', done);
    dest.on('error', done);
    gcsFakeWritestream.on('error', done);

    source.pipe(dest);

    dest.on('file not saved', () => {
        done(new Error('File not saved'));
    });

    dest.on('file saved', (id, file) => {
        expect(id).toMatchSnapshot();
        expect(file).toMatchSnapshot();
        done();
    });
});

test('.get() - should resolve fileContent when file exist', async () => {
    const sink = getValidSink();

    await sink._ready;

    const download = 'some-file-content';
    sink.gcs._setState({
        download,
    });

    const result = await sink.get('some-file');
    expect(result).toBe(download);
});

test('.set() - should return no value/undefined if success', async () => {
    const sink = getValidSink();

    await sink._ready;

    sink.gcs._setState({ save: '' });

    const result = await sink.set('some-file', 'file-content');

    expect(result).toBe(undefined);
});

test('.has() - should return true if file exists', async () => {
    const sink = getValidSink();

    await sink._ready;

    sink.gcs._setState({ exists: [true] });

    const result = await sink.has('some-file');

    expect(result).toBe(true);
});

test('.has() - should return false if missing', async () => {
    const sink = getValidSink();

    await sink._ready;

    sink.gcs._setState({ exists: [] });

    const result = await sink.has('some-file');

    expect(result).toBe(false);

    sink.gcs._setState({ exists: null });

    const result2 = await sink.has('some-file');

    expect(result2).toBe(false);
});
