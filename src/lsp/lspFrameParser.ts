import { isJsonRpcMessage, type JsonRpcMessage } from "./protocol.js";

const CARRIAGE_RETURN = 13;
const LINE_FEED = 10;

export class LspFrameParser {
  readonly #headerDecoder = new TextDecoder("ascii");
  readonly #bodyDecoder = new TextDecoder();
  #buffer: number[] = [];
  #contentLength: number | undefined;

  push(byte: number): JsonRpcMessage[] {
    this.#buffer.push(byte & 0xff);
    if (this.#contentLength === undefined) {
      const length = this.#buffer.length;
      if (
        length < 4 ||
        this.#buffer[length - 4] !== CARRIAGE_RETURN ||
        this.#buffer[length - 3] !== LINE_FEED ||
        this.#buffer[length - 2] !== CARRIAGE_RETURN ||
        this.#buffer[length - 1] !== LINE_FEED
      ) {
        return [];
      }

      const header = this.#headerDecoder.decode(new Uint8Array(this.#buffer.slice(0, -4)));
      this.#buffer = [];
      const match = header.match(/(?:^|\r\n)Content-Length:\s*(\d+)/i);
      if (!match) return [];
      this.#contentLength = Number.parseInt(match[1], 10);
      if (this.#contentLength !== 0) return [];
      this.#contentLength = undefined;
      return [];
    }

    if (this.#buffer.length < this.#contentLength) return [];
    const body = new Uint8Array(this.#buffer);
    this.#buffer = [];
    this.#contentLength = undefined;
    const parsed: unknown = JSON.parse(this.#bodyDecoder.decode(body));
    return isJsonRpcMessage(parsed) ? [parsed] : [];
  }
}
