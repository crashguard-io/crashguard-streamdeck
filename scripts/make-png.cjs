const zlib = require("zlib");
const fs = require("fs");

function crc32(buf) {
	let c;
	let crc = 0xffffffff;
	for (let i = 0; i < buf.length; i++) {
		c = (crc ^ buf[i]) & 0xff;
		for (let j = 0; j < 8; j++) {
			c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
		}
		crc = (crc >>> 8) ^ c;
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
	const typeBuf = Buffer.from(type, "ascii");
	const lenBuf = Buffer.alloc(4);
	lenBuf.writeUInt32BE(data.length, 0);
	const crcBuf = Buffer.alloc(4);
	crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
	return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function makePng(width, height, [r, g, b]) {
	const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 2; // color type RGB
	ihdr[10] = 0;
	ihdr[11] = 0;
	ihdr[12] = 0;

	const rowBytes = width * 3;
	const raw = Buffer.alloc((rowBytes + 1) * height);
	for (let y = 0; y < height; y++) {
		const rowStart = y * (rowBytes + 1);
		raw[rowStart] = 0; // filter byte
		for (let x = 0; x < width; x++) {
			const px = rowStart + 1 + x * 3;
			raw[px] = r;
			raw[px + 1] = g;
			raw[px + 2] = b;
		}
	}
	const idat = zlib.deflateSync(raw);

	return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

const [, , outPath, sizeArg, colorArg] = process.argv;
const size = parseInt(sizeArg, 10);
const color = colorArg.match(/.{2}/g).map((h) => parseInt(h, 16));
fs.writeFileSync(outPath, makePng(size, size, color));
