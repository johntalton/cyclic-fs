
export const DEFAULT_BASE_ADDRESS = 0
export const DEFAULT_STRIDE = 32
export const DEFAULT_LITTLE_ENDIAN = false
export const DEFAULT_FULL_SCAN = false

export const HEADER_SIZE = 4
export const HEADER_INIT_VALUE8 = 0xFF
export const HEADER_INIT_VALUE32 = 0xFF_FF_FF_FF

/**
 * @param {number} start
 * @param {number} end
 * @param {number} [step = 1]
 */
export function* range(start, end, step = 1) {
	for(let i = start; i <= end; i += step) {
		yield i
	}
}

/**
 * @typedef {Object} EEPROM
 *
 */

/**
 * @typedef {number} Version
 */

/**
 * @typedef {Object} Slot
 * @property {Version} version
 * @property {BufferSource} data
 */

/**
 * @typedef {Object} CyclicFSOptions
 * @property {number} [baseAddress = DEFAULT_BASE_ADDRESS]
 * @property {number} [stride = DEFAULT_STRIDE]
 * @property {boolean} [littleEndian = DEFAULT_LITTLE_ENDIAN]
 * @property {boolean} [fullScan = DEFAULT_FULL_SCAN]
 */

/**
 * @typedef {Object} VersionOptions
 * @property {number} baseAddress
 * @property {boolean} littleEndian
 */

/**
 * @typedef {Object} ConfigOptions
 * @property {number} byteLength
 * @property {number} stride
 */

/**
 * @typedef {VersionOptions & ConfigOptions} ListOptions
 *
 */

/**
 * @typedef {Object} SearchOptionsBase
 * @property {boolean} [fullScan = DEFAULT_FULL_SCAN]
 */

/**
 * @typedef {VersionOptions & ConfigOptions & SearchOptionsBase} SearchOptions
 */

/**
 * @typedef {Object} SearchResult
 * @property {Version} version
 * @property {number} offset
 * @property {boolean} empty
 */

/**
 * @typedef {SearchResult & SearchOptions} Metadata
 */

export class CyclicFS {
	/**
	 * @param {EEPROM} eeprom
	 * @param {number} byteLength
	 * @param {CyclicFSOptions} [options]
	 * @returns {Promise<void>}
	 */
	static async format(eeprom, byteLength, options = undefined) {
		const baseAddress = options?.baseAddress ?? DEFAULT_BASE_ADDRESS
		return eeprom.write(baseAddress, Uint8Array.from([ ...range(0, byteLength - 1).map(value => HEADER_INIT_VALUE8) ]))
	}

	/**
	 * @param {EEPROM} eeprom
	 * @param {number} byteLength
	 * @param {CyclicFSOptions} [options]
	 * @returns {Promise<Metadata>}
	 */
	static async init(eeprom, byteLength, options = undefined) {
		const baseAddress = options?.baseAddress ?? DEFAULT_BASE_ADDRESS
		const stride = options?.stride ?? DEFAULT_STRIDE
		const littleEndian = options?.littleEndian ?? DEFAULT_LITTLE_ENDIAN
		const fullScan = options?.fullScan ?? DEFAULT_FULL_SCAN

		const meta = {
			baseAddress,
			stride,
			littleEndian,
			byteLength,
			fullScan
		}
		const metameta = await CyclicFS.#search(eeprom, meta)
		return {
			...meta,
			...metameta
		}
	}

	/**
	 * @param {EEPROM} eeprom
	 * @param {number} offset
	 * @param {VersionOptions & ConfigOptions} options
	 * @returns {Promise<Slot>}
	 */
	static async #readSlot(eeprom, offset, options) {
		const { baseAddress, littleEndian, stride } = options

		const block = await eeprom.read(baseAddress + offset, stride)

		const headerDV = ArrayBuffer.isView(block) ?
			new DataView(block.buffer, block.byteOffset, HEADER_SIZE) :
			new DataView(block, 0, HEADER_SIZE)

		const version = headerDV.getUint32(0, littleEndian)

		const blockU8 = ArrayBuffer.isView(block) ?
			new Uint8Array(block.buffer, block.byteOffset, block.byteLength) :
			new Uint8Array(block)

		const data = blockU8.subarray(HEADER_SIZE)

		return {
			version,
			data
		}
	}

	/**
	 * @param {EEPROM} eeprom
	 * @param {Metadata} metadata
	 * @returns {Promise<BufferSource|undefined>}
	 */
	static async read(eeprom, metadata) {
		const { version, offset, empty } = metadata
		if(empty) { return undefined }

		const { version: slotVersion, data } = await CyclicFS.#readSlot(eeprom, offset, metadata)
		if(slotVersion !== version) { throw new Error('version miss-match') }

		return data
	}

	/**
	 * @param {EEPROM} eeprom
	 * @param {Metadata} metadata
	 * @param {BufferSource} buffer
	 * @returns {Promise<void>}
	 */
	static async write(eeprom, metadata, buffer) {
		const { version, offset, stride, littleEndian, empty, byteLength } = metadata
		if(buffer === undefined) { throw new Error('buffer undefined') }
		if((buffer.byteLength + HEADER_SIZE) > stride) { throw new Error('buffer size larger then stride') }

		const wrap = (offset + stride) >= byteLength

		const nextVersion = empty ? version : version + 1
		const nextOffset = empty ? offset : wrap ? 0 : offset + stride

		const header = new Uint8Array(HEADER_SIZE)
		const headerDV = new DataView(header.buffer)
		headerDV.setUint32(0, nextVersion, littleEndian)

		const blob = new Blob([ header, buffer ])
		const block = await blob.arrayBuffer()

		await eeprom.write(metadata.baseAddress + nextOffset, block)

		metadata.version = nextVersion
		metadata.offset = nextOffset
		metadata.empty = false
	}

	/**
	 * @param {EEPROM} eeprom
	 * @param {number} offset
	 * @param {VersionOptions} options
	 * @returns {Promise<Version>}
	 */
	static async #readVersion(eeprom, offset, options) {
		const { baseAddress, littleEndian } = options

		const header = await eeprom.read(baseAddress + offset, HEADER_SIZE)
		const dv = ArrayBuffer.isView(header) ?
			new DataView(header.buffer, header.byteOffset, header.byteLength) :
			new DataView(header)

		return dv.getUint32(0, littleEndian)
	}

	/**
	 * @param {EEPROM} eeprom
	 * @param {SearchOptions} options
	 * @returns {Promise<SearchResult>}
	 */
	static async #search(eeprom, options) {
		const { fullScan } = options
		if(fullScan) { return CyclicFS.#search_linear(eeprom, options) }
		return CyclicFS.#search_binary(eeprom, options)
	}

	/**
	 * @param {EEPROM} eeprom
	 * @param {SearchOptions} options
	 * @returns {Promise<SearchResult>}
	 */
	static async #search_linear(eeprom, options) {
		const { byteLength, stride } = options

		const result = {
			version: 0,
			offset: 0,
			empty: true
		}

		for(const offset of range(0, byteLength - 1, stride)) {
			const version = await CyclicFS.#readVersion(eeprom, offset, options)
			if(version === HEADER_INIT_VALUE32) { break }

			if(version > result.version || result.empty) {
				result.version = version
				result.offset = offset
				result.empty = false
			}
		}

		return result
	}

	/**
	 * @param {EEPROM} eeprom
	 * @param {SearchOptions} options
	 * @returns {Promise<SearchResult>}
	 */
	static async #search_binary(eeprom, options) {
		const { byteLength, stride } = options

		async function _search(startPos, endPos, startValue) {
			if(startPos === endPos) {
				return { version: startValue, offset: startPos * stride, empty: false }
			}

			const pivot = Math.floor(startPos + (endPos - startPos) / 2)
			const pivotValue = await CyclicFS.#readVersion(eeprom, pivot * stride, options)

			if((pivotValue < startValue) || (pivotValue === HEADER_INIT_VALUE32)) {
				// Pivot Left
				return _search(startPos, pivot - 1, startValue)
			}

			// Pivot Right
			const newStartValue = await CyclicFS.#readVersion(eeprom, (pivot + 1) * stride, options)
			if((pivotValue > newStartValue) || (newStartValue === HEADER_INIT_VALUE32)) {
				return { version: pivotValue, offset: pivot * stride, empty: false }
			}
			return _search(pivot + 1, endPos, newStartValue)
		}

		//
		const value = await CyclicFS.#readVersion(eeprom, 0, options)
		if(value === HEADER_INIT_VALUE32) {
			return { version: 0, offset: 0, empty: true }
		}

		const slotCount = Math.floor(byteLength / stride)
		return _search(0, slotCount - 1, value)
	}


	/**
	 * @param {EEPROM} eeprom
	 * @param {ListOptions} options
	 * @returns {AsyncGenerator<Slot>}
	 */
	static async *listSlots(eeprom, options) {
		const { byteLength, stride } = options

		for(const offset of range(0, byteLength - 1, stride)) {
			yield CyclicFS.#readSlot(eeprom, offset, options)
		}
	}

	/**
	 * @param {EEPROM} eeprom
	 * @param {Metadata} metadata
	 * @returns {AsyncGenerator<Slot>}
	 */
	static async *list(eeprom, metadata) {
		const { byteLength, stride, offset, empty } = metadata
		if(empty) { return }

		for(const relativeOffset of range(0, byteLength - 1, stride)) {
			const actualOffset = (offset - relativeOffset + byteLength) % byteLength
			const slot = await CyclicFS.#readSlot(eeprom, actualOffset, metadata)
			if(slot.version === HEADER_INIT_VALUE32) { break }
			yield slot
		}
	}
}
