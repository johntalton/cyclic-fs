import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
	CyclicFS,
	DEFAULT_BASE_ADDRESS,
	DEFAULT_LITTLE_ENDIAN,
	DEFAULT_STRIDE,
	HEADER_INIT_VALUE32,
	HEADER_SIZE
} from '@johntalton/cyclic-fs'

class MockEEPROM {
	#readRaw
	byteLength = 64
	u8 = new Uint8Array(64)

	constructor(options) {
		this.#readRaw = options?.readRaw ?? false
		// fill with random from 1..254 (not 0 or 255 for asserts)
		this.u8 = this.u8.map(() => Math.trunc(Math.random() * (255 - 2) + 1))
	}

	async read(offset, length, target) {
		if(target !== undefined) { throw new Error('no byob') }
		if(offset >= this.byteLength) { throw new Error('out of range') }
		const result = this.u8.subarray(offset, offset + length)

		if(!this.#readRaw) { return result }

		const rawResult = new Uint8Array(result.byteLength)
		rawResult.set(result)
		return rawResult.buffer
	}

	async write(offset, buffer) {
		if(offset + buffer.byteLength > this.byteLength) { throw new Error('overflow') }

		const bufferU8 = ArrayBuffer.isView(buffer) ?
			new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength) :
			new Uint8Array(buffer, 0, buffer.byteLength)

		this.u8.set(bufferU8, offset)
	}
}


describe('CyclicFS', () => {
	describe('format', () => {
		it('should format ArrayBuffer', async () => {
			const mock = new MockEEPROM()
			await CyclicFS.format(mock, mock.byteLength)
			assert.deepEqual(mock.u8[0], 0xFF)
		})

		it('should format ArrayBuffer', async () => {
			const mock = new MockEEPROM()
			const baseAddress = 32
			await CyclicFS.format(mock, mock.byteLength / 2, { baseAddress })
			assert.ok(mock.u8[0] !== 0)
			assert.ok(mock.u8[31] !== 0)
			assert.ok(mock.u8[0] !== 0xFF)
			assert.ok(mock.u8[31] !== 0xFF)
			assert.equal(mock.u8[32], 0xFF)
			assert.equal(mock.u8[63], 0xFF)
		})

		it('should reject if byteLength invalid', async () => {
			const mock = new MockEEPROM()
			await assert.rejects(async () => {
				await CyclicFS.format(mock, mock.byteLength + 1)
			})
		})
	})

	describe('init', () => {
		it('should init pre format', async () => {
			const mock = new MockEEPROM()
			const handle = await CyclicFS.init(mock, mock.byteLength)
			assert.equal(handle.baseAddress, DEFAULT_BASE_ADDRESS)
			assert.equal(handle.byteLength, mock.byteLength)
			assert.equal(handle.empty, false) // un-formatted
			// assert.equal(handle.offset, 0)
			assert.equal(handle.stride, DEFAULT_STRIDE)
			// assert.equal(handle.version, 0)
		})

		it('should init after format', async () => {
			const mock = new MockEEPROM()
			await CyclicFS.format(mock, mock.byteLength)
			const handle = await CyclicFS.init(mock, mock.byteLength)
			assert.equal(handle.baseAddress, DEFAULT_BASE_ADDRESS)
			assert.equal(handle.byteLength, mock.byteLength)
			assert.equal(handle.empty, true)
			assert.equal(handle.offset, 0)
			assert.equal(handle.stride, DEFAULT_STRIDE)
			assert.equal(handle.version, 0)
		})

		it('should init after format with options', async () => {
			const mock = new MockEEPROM()
			await CyclicFS.format(mock, mock.byteLength)
			const options = {
				baseAddress: 16,
				stride: 8,
				littleEndian: false
			}
			const handle = await CyclicFS.init(mock, mock.byteLength / 2, options)
			assert.equal(handle.baseAddress, options.baseAddress)
			assert.equal(handle.byteLength, mock.byteLength / 2)
			assert.equal(handle.empty, true)
			assert.equal(handle.offset, 0)
			assert.equal(handle.stride, options.stride)
			assert.equal(handle.version, 0)
		})

		it('should re-init after writes', async () => {
			const mock = new MockEEPROM()
			await CyclicFS.format(mock, mock.byteLength)
			const handle = await CyclicFS.init(mock, mock.byteLength, { stride: 8 })

			const slotCount = mock.byteLength / handle.stride
			assert.equal(slotCount, 8)

			await CyclicFS.write(mock, handle, Uint8Array.from([ 1,2,3,4 ]))
			await CyclicFS.write(mock, handle, Uint8Array.from([ 5,6,7,8 ]))

			const newHandle = await CyclicFS.init(mock, mock.byteLength, { stride: 8 })

			assert.equal(newHandle.baseAddress, 0)
			assert.equal(newHandle.byteLength, mock.byteLength)
			assert.equal(newHandle.empty, false)
			assert.equal(newHandle.littleEndian, DEFAULT_LITTLE_ENDIAN)
			assert.equal(newHandle.offset, 8)
			assert.equal(newHandle.stride, 8)
			assert.equal(newHandle.version, 1)

		})

		it('should init data wrapped even', async () => {
			const mock = new MockEEPROM()
			await CyclicFS.format(mock, mock.byteLength)
			const handle = await CyclicFS.init(mock, mock.byteLength, { stride: 8 })

			const count = mock.byteLength / handle.stride
			assert.equal(count, 8)

			const fillCount = (count * 2) + (count / 2)
			assert.ok(fillCount % 2 === 0)

			for(let i = 0; i < fillCount; i += 1) {
				await CyclicFS.write(mock, handle, Uint8Array.from([ 7,8,9,0 ]))
			}

			const newHandle = await CyclicFS.init(mock, mock.byteLength, { stride: 8 })
			assert.equal(newHandle.baseAddress, 0)
			assert.equal(newHandle.byteLength, mock.byteLength)
			assert.equal(newHandle.empty, false)
			assert.equal(newHandle.littleEndian, false)
			assert.equal(newHandle.offset, 24)
			assert.equal(newHandle.stride, 8)
			assert.equal(newHandle.version, 19)
		})

		it('should init data wrapped odd', async () => {
			const mock = new MockEEPROM()
			await CyclicFS.format(mock, mock.byteLength)
			const handle = await CyclicFS.init(mock, mock.byteLength, { stride: 8 })

			const count = mock.byteLength / handle.stride
			assert.equal(count, 8)

			const fillCount = (count * 2) + (count / 2) + 1
			assert.ok(fillCount % 2 === 1)

			for(let i = 0; i < fillCount; i += 1) {
				await CyclicFS.write(mock, handle, Uint8Array.from([ 7,8,9,0 ]))
			}

			const newHandle = await CyclicFS.init(mock, mock.byteLength, { stride: 8 })

			assert.equal(newHandle.baseAddress, 0)
			assert.equal(newHandle.byteLength, mock.byteLength)
			assert.equal(newHandle.empty, false)
			assert.equal(newHandle.littleEndian, false)
			assert.equal(newHandle.offset, 32)
			assert.equal(newHandle.stride, 8)
			assert.equal(newHandle.version, 20)

		})

		it('should init with full scan empty', async () => {
			const mock = new MockEEPROM()
			await CyclicFS.format(mock, mock.byteLength)
			const handle = await CyclicFS.init(mock, mock.byteLength, { fullScan: true })

			assert.equal(handle.baseAddress, 0)
			assert.equal(handle.byteLength, mock.byteLength)
			assert.equal(handle.empty, true)
			assert.equal(handle.littleEndian, DEFAULT_LITTLE_ENDIAN)
			assert.equal(handle.offset, 0)
			assert.equal(handle.stride, DEFAULT_STRIDE)
			assert.equal(handle.version, 0)

		})

		it('should init with full scan non-empty', async () => {
			const mock = new MockEEPROM()
			await CyclicFS.format(mock, mock.byteLength)
			const handle = await CyclicFS.init(mock, mock.byteLength, { fullScan: true, stride: 8 })

			const slotCount = mock.byteLength / handle.stride
			assert.equal(slotCount, 8)

			await CyclicFS.write(mock, handle, Uint8Array.from([ 1,2,3,4 ]))
			await CyclicFS.write(mock, handle, Uint8Array.from([ 5,6,7,8 ]))

			const newHandle = await CyclicFS.init(mock, mock.byteLength, { fullScan: true, stride: 8 })

			assert.equal(newHandle.baseAddress, 0)
			assert.equal(newHandle.byteLength, mock.byteLength)
			assert.equal(newHandle.empty, false)
			assert.equal(newHandle.littleEndian, DEFAULT_LITTLE_ENDIAN)
			assert.equal(newHandle.offset, 8)
			assert.equal(newHandle.stride, 8)
			assert.equal(newHandle.version, 1)
		})

		it('should init with full scan non-empty wrapped', async () => {
			const mock = new MockEEPROM()
			await CyclicFS.format(mock, mock.byteLength)
			const handle = await CyclicFS.init(mock, mock.byteLength, { fullScan: true, stride: 8 })

			const slotCount = mock.byteLength / handle.stride
			assert.equal(slotCount, 8)

			await CyclicFS.write(mock, handle, Uint8Array.from([ 1,2,3,4 ]))
			await CyclicFS.write(mock, handle, Uint8Array.from([ 5,6,7,8 ]))
			await CyclicFS.write(mock, handle, Uint8Array.from([ 9, 10, 11, 12 ]))

			const newHandle = await CyclicFS.init(mock, mock.byteLength, { fullScan: true, stride: 8 })

			assert.equal(newHandle.baseAddress, 0)
			assert.equal(newHandle.byteLength, mock.byteLength)
			assert.equal(newHandle.empty, false)
			assert.equal(newHandle.littleEndian, DEFAULT_LITTLE_ENDIAN)
			assert.equal(newHandle.offset, 16)
			assert.equal(newHandle.stride, 8)
			assert.equal(newHandle.version, 2)
		})
	})

	describe('read', () => {
		it('should return undefined on read empty', async () => {
			const mock = new MockEEPROM()
			await CyclicFS.format(mock, mock.byteLength)
			const handle = await CyclicFS.init(mock, mock.byteLength)

			const buffer = await CyclicFS.read(mock, handle)
			assert.equal(buffer, undefined)
		})

		it('should reject if invalid read', async () => {
			const mock = new MockEEPROM()
			await CyclicFS.format(mock, mock.byteLength)
			const handle = await CyclicFS.init(mock, mock.byteLength)

			await assert.rejects(async () => {
				const buffer = await CyclicFS.read(mock, {
					...handle,
					empty: false,
					offset: mock.byteLength,
				})
			})
		})

		it('should reject if handle version is outdated', async () => {
			const mock = new MockEEPROM()
			await CyclicFS.format(mock, mock.byteLength)
			const handle = await CyclicFS.init(mock, mock.byteLength)

			await CyclicFS.write(mock, handle, Uint8Array.from([ 42 ]))

			const badHandle = structuredClone(handle)
			badHandle.version = 42

			await assert.rejects(async () => await CyclicFS.read(mock, badHandle))
		})

		it('should read written value', async () => {
			const mock = new MockEEPROM()
			await CyclicFS.format(mock, mock.byteLength)
			const handle = await CyclicFS.init(mock, mock.byteLength)

			// todo

		})

		it('should read written value once wrapped', async () => {
			const mock = new MockEEPROM()
			await CyclicFS.format(mock, mock.byteLength)
			const handle = await CyclicFS.init(mock, mock.byteLength)

			// todo

		})

		it('should handle reads of raw ArrayBuffers', async () => {
			const mock = new MockEEPROM({ readRaw: true})
			await CyclicFS.format(mock, mock.byteLength)
			const handle = await CyclicFS.init(mock, mock.byteLength)

			await CyclicFS.write(mock, handle, Uint8Array.from([ 1,2,3,4 ]))
			const buffer = await CyclicFS.read(mock, handle)
			assert.ok(buffer !== undefined)
			const buffer8 = ArrayBuffer.isView(buffer) ?
				new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength) :
				new Uint8Array(buffer)
			assert.equal(buffer8[0], 1)
			assert.equal(buffer8[3], 4)

		})
	})

	describe('write', () => {
		it('should reject write with invalid buffer', async () => {
			const mock = new MockEEPROM()
			await CyclicFS.format(mock, mock.byteLength)
			const handle = await CyclicFS.init(mock, mock.byteLength)

			await assert.rejects(async () => {
				await CyclicFS.write(mock, handle, undefined)
			})
		})

		it('should reject if write outside bounds', async () => {
			const mock = new MockEEPROM()
			await CyclicFS.format(mock, mock.byteLength)
			const handle = await CyclicFS.init(mock, mock.byteLength)

			await assert.rejects(async () => {
				await CyclicFS.write(mock, handle, new Uint8Array({ length: mock.byteLength }))
			})
		})

		it('should write data to empty', async () => {
			const mock = new MockEEPROM()
			await CyclicFS.format(mock, mock.byteLength)
			const handle = await CyclicFS.init(mock, mock.byteLength)

			assert.ok(handle.empty)
			assert.equal(handle.version, 0)

			const source = Uint8Array.from([ 1,2,3,4 ])
			await CyclicFS.write(mock, handle, source)

			assert.ok(!handle.empty)
			assert.equal(handle.version, 0)

			const buffer = await CyclicFS.read(mock, handle)
			assert.ok(buffer !== undefined)
			assert.equal(buffer.byteLength, handle.stride - HEADER_SIZE)
			const buffer8 = ArrayBuffer.isView(buffer) ?
				new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength) :
				new Uint8Array(buffer)
			assert.equal(buffer8[0], source[0])
			assert.equal(buffer8[3], source[3])

		})

		it('should write data to non-empty', async () => {
			const mock = new MockEEPROM()
			await CyclicFS.format(mock, mock.byteLength)
			const handle = await CyclicFS.init(mock, mock.byteLength)

			await CyclicFS.write(mock, handle, Uint8Array.from([ 1,2,3,4 ]))
			const source = Uint8Array.from([ 5,6,7,8 ])
			await CyclicFS.write(mock, handle, source)

			assert.ok(!handle.empty)
			assert.equal(handle.version, 1)

			const buffer = await CyclicFS.read(mock, handle)

			assert.ok(buffer !== undefined)
			const buffer8 = ArrayBuffer.isView(buffer) ?
				new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength) :
				new Uint8Array(buffer)
			assert.equal(buffer8[0], source[0])
			assert.equal(buffer8[3], source[3])
		})

		it('should write data wrapped', async () => {
			const mock = new MockEEPROM()
			await CyclicFS.format(mock, mock.byteLength)
			const handle = await CyclicFS.init(mock, mock.byteLength, { stride: 8 })

			const count = mock.byteLength / handle.stride
			assert.equal(count, 8)

			const fillCount = (count * 2) + (count / 2)

			for(let i = 0; i < fillCount; i += 1) {
				await CyclicFS.write(mock, handle, Uint8Array.from([ 7,8,9,0 ]))
			}

			const source = Uint8Array.from([ 42, 37, 77, 0xFF ])
			await CyclicFS.write(mock, handle, source)

			assert.ok(!handle.empty)
			assert.equal(handle.version, 20)

			const buffer = await CyclicFS.read(mock, handle)

			assert.ok(buffer !== undefined)
			const buffer8 = ArrayBuffer.isView(buffer) ?
				new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength) :
				new Uint8Array(buffer)
			assert.equal(buffer8[0], source[0])
			assert.equal(buffer8[3], source[3])
		})
	})

	describe('listSlots', () => {
		it('should list empty', async () => {
			const mock = new MockEEPROM()
			await CyclicFS.format(mock, mock.byteLength)
			const handle = await CyclicFS.init(mock, mock.byteLength - 8, { baseAddress: 8, stride: 8 })

			const iter = CyclicFS.listSlots(mock, handle)
			const ary = await Array.fromAsync(iter)

			assert.equal(ary.length, 7)

			const [ first ] = ary

			assert.equal(first.version, HEADER_INIT_VALUE32)
		})
	})

	describe('list', () => {
		it('should list empty', async () => {
			const mock = new MockEEPROM()
			await CyclicFS.format(mock, mock.byteLength)
			const handle = await CyclicFS.init(mock, mock.byteLength - 8, { baseAddress: 8, stride: 8 })

			const iter = CyclicFS.list(mock, handle)
			const first = await iter.next()
			assert.ok(first.done)
		})

		it('should list files descending', async () => {
			const mock = new MockEEPROM()
			await CyclicFS.format(mock, mock.byteLength)
			const handle = await CyclicFS.init(mock, mock.byteLength, { stride: 8 })

			await CyclicFS.write(mock, handle, Uint32Array.from([ 42 ]))
			await CyclicFS.write(mock, handle, Uint32Array.from([ 37 ]))

			assert.equal(handle.offset, 8)
			assert.equal(handle.version, 1)

			const iter = CyclicFS.list(mock, handle)
			const ary = await Array.fromAsync(iter)
			assert.equal(ary.length, 2)

			assert.equal(ary[0].version, 1)
			assert.equal(ary[1].version, 0)

		})

		it('should list files when wrapped', async () => {
			const mock = new MockEEPROM()
			await CyclicFS.format(mock, mock.byteLength)
			const handle = await CyclicFS.init(mock, mock.byteLength, { stride: 16 })

			const slotCount = mock.byteLength / handle.stride
			assert.equal(slotCount, 4)

			await CyclicFS.write(mock, handle, Uint32Array.from([ 42 ]))
			await CyclicFS.write(mock, handle, Uint32Array.from([ 37 ]))
			await CyclicFS.write(mock, handle, Uint32Array.from([ 77 ]))
			await CyclicFS.write(mock, handle, Uint32Array.from([ 99 ]))
			await CyclicFS.write(mock, handle, Uint32Array.from([ 69 ]))
			await CyclicFS.write(mock, handle, Uint32Array.from([ 0 ]))

			assert.equal(handle.offset, 16)
			assert.equal(handle.version, 5)

			const iter = CyclicFS.list(mock, handle)
			const ary = await Array.fromAsync(iter)
			assert.equal(ary.length, 4)

			assert.equal(ary[0].version, 5)
			assert.equal(ary[1].version, 4)
			assert.equal(ary[2].version, 3)
			assert.equal(ary[3].version, 2)
		})
	})
})
