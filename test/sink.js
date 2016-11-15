"use strict";

const stream = require('stream');
const concat = require('concat-stream');
const Sink = require('../');
const tap = require('tap');


const sourceStream = (arr) => {
    return new stream.Readable({
        objectMode : false,
        read: function (n) {
            arr.forEach((chunk) => {
                this.push(chunk);
            });
            this.push(null);
        }
    });
}

const a = ['a','b','c'];
const b = ['d', 'a','b','c'];


tap.test('not a real test', (t) => {
    const sink = new Sink;
    sourceStream(a).pipe(sink.writer('js', (name) => {
        console.log(name);

        sink.reader(name).pipe(concat((m) => {
            console.log(m.toString());
            t.end();
        }));

    }));

});
