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
        // eslint-disable-next-line no-new
        new SinkGCS();
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
        // eslint-disable-next-line no-new
        new SinkGCS(
            {
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
    }).toThrowError('Expected argument "type" to be provided to writer');
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

    const content = 'some-file-content';
    sink.gcs._setState({
        download: {
            'some-file': content,
        },
    });

    const result = await sink.get('some-file');
    expect(result).toBe(content);
});

test('.set() - should return no value/undefined if success', async () => {
    const sink = getValidSink();

    await sink._ready;

    sink.gcs._setState({ save: '' });

    const result = await sink.set('some-file.json', 'file-content');

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

test('dir() - should error when invalid response from getFiles', async () => {
    expect.assertions(1);
    const sink = getValidSink();

    await sink._ready;

    sink.gcs._setState({ getFiles: { '/': [] } });

    try {
        await sink.dir('/');
    } catch (e) {
        expect(e).toMatchSnapshot();
    }
});

test('dir() - should error when no files', async () => {
    expect.assertions(1);
    const sink = getValidSink();

    await sink._ready;

    sink.gcs._setState({ getFiles: { 'some-dir/': [[]] } });

    try {
        await sink.dir('/some-dir');
    } catch (e) {
        expect(e).toMatchSnapshot();
    }
});

test('dir() - should error when no matching files', async () => {
    expect.assertions(1);
    const sink = getValidSink();

    await sink._ready;

    sink.gcs._setState({
        getFiles: {
            'folder/': [
                [sink.gcs.bucket().file('/non/matching/filename.json')],
            ],
        },
    });

    try {
        const result = await sink.dir('/folder');
        console.log(result);
    } catch (e) {
        expect(e).toMatchSnapshot();
    }
});

test('dir() - should output 1 file', async () => {
    expect.assertions(1);
    const sink = getValidSink();

    await sink._ready;

    const fileName = 'some-path/some-file-name.json';
    sink.gcs._setState({
        download: { [fileName]: 'file-content' },
        getFiles: {
            'some-path/': [[sink.gcs.bucket().file(fileName)]],
        },
    });

    const files = await sink.dir('/some-path');
    expect(files).toMatchSnapshot();
});

test('dir() - should output 1 file with extra slash', async () => {
    expect.assertions(1);
    const sink = getValidSink();

    await sink._ready;

    const fileName = 'some-path/some-file-name.json';
    sink.gcs._setState({
        download: { [fileName]: 'file-content' },
        getFiles: {
            'some-path/': [[sink.gcs.bucket().file(fileName)]],
        },
    });

    const files = await sink.dir('/some-path/');
    expect(files).toMatchSnapshot();
});

test('dir() - should output 3 file', async () => {
    expect.assertions(1);
    const sink = getValidSink();

    await sink._ready;

    const fileName1 = 'some-path/some-file-name-1';
    const fileName2 = 'some-path/some-file-name-2';
    const fileName3 = 'some-path/some-file-name-3';
    sink.gcs._setState({
        download: {
            [fileName1]: 'file-content-1',
            [fileName2]: 'file-content-2',
            [fileName3]: 'file-content-3',
        },
        getFiles: {
            'some-path/': [
                [
                    sink.gcs.bucket().file(fileName1),
                    sink.gcs.bucket().file(fileName2),
                    sink.gcs.bucket().file(fileName3),
                ],
            ],
        },
    });

    const files = await sink.dir('/some-path');
    expect(files).toMatchSnapshot();
});

test('dir() - should output 3 files with extensions', async () => {
    expect.assertions(1);
    const sink = getValidSink();

    await sink._ready;

    const fileName1 = 'some-path/some-file-name-4.json';
    const fileName2 = 'some-path/some-file-name-5.css';
    const fileName3 = 'some-path/some-file-name-6.js';
    sink.gcs._setState({
        download: {
            [fileName1]: 'file-content-4',
            [fileName2]: 'file-content-5',
            [fileName3]: 'file-content-6',
        },
        getFiles: {
            'some-path/': [
                [
                    sink.gcs.bucket().file(fileName1),
                    sink.gcs.bucket().file(fileName2),
                    sink.gcs.bucket().file(fileName3),
                ],
            ],
        },
    });

    const files = await sink.dir('/some-path');
    expect(files).toMatchSnapshot();
});
