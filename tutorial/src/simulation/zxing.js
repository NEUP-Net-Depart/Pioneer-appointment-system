import { prepareZXingModule, writeBarcode } from 'zxing-wasm/writer';
import wasmUrl from 'zxing-wasm/writer/zxing_writer.wasm?url';
import { prepareZXingModule as prepareReader, readBarcodes } from 'zxing-wasm/reader';
import readerUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

prepareZXingModule({ overrides: { locateFile: () => wasmUrl } });
prepareReader({ overrides: { locateFile: () => readerUrl } });
export async function qrImage(code) {
  const result = await writeBarcode(code, { format: 'QRCode', scale: 6 });
  if (!result.image) throw new Error('演示二维码生成失败。');
  return result.image;
}
export async function readQr(input) {
  return readBarcodes(input, { formats: ['QRCode'], tryHarder: true });
}
export async function readDeviceCode(input) {
  return readBarcodes(input, {
    formats: ['QRCode', 'DataMatrix', 'Code128', 'Code39', 'Code93', 'PDF417'],
    tryHarder: true
  });
}
