let reader, writer;
export async function readQr(input) {
  return readCodes(input, ['QRCode']);
}
export async function readDeviceCode(input) {
  return readCodes(input, ['QRCode', 'DataMatrix', 'Code128', 'Code39', 'Code93', 'PDF417'], 8);
}
async function readCodes(input, formats, maxNumberOfSymbols = 1) {
  if (!reader) {
    reader = import('/vendor/zxing-reader.js')
      .then((module) => {
        module.prepareZXingModule({ overrides: { locateFile: () => '/vendor/zxing_reader.wasm' } });
        return module;
      })
      .catch((error) => {
        reader = undefined;
        throw error;
      });
  }
  return (await reader).readBarcodes(input, { formats, tryHarder: true, maxNumberOfSymbols });
}
export async function qrImage(code) {
  if (!writer) {
    writer = import('/vendor/zxing-writer.js')
      .then((module) => {
        module.prepareZXingModule({ overrides: { locateFile: () => '/vendor/zxing_writer.wasm' } });
        return module;
      })
      .catch((error) => {
        writer = undefined;
        throw error;
      });
  }
  const result = await (
    await writer
  ).writeBarcode(code, { format: 'QRCode', scale: 6, options: 'ecLevel=M' });
  if (result.error || !result.image) throw new Error('二维码生成失败，请稍后重试');
  return result.image;
}
