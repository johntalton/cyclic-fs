# Cyclic FS


[![npm Version](http://img.shields.io/npm/v/@johntalton/cyclic-fs.svg)](https://www.npmjs.com/package/@johntalton/cyclic-fs)
![GitHub package.json version](https://img.shields.io/github/package-json/v/johntalton/cyclic-fs)
![CI](https://github.com/johntalton/cyclic-fs/workflows/CI/badge.svg)
![GitHub](https://img.shields.io/github/license/johntalton/cyclic-fs)


A circular buffer overtop of the EEPROM providing "latest-bucket" storage.

EEPROM have a wider range of use cases.  For logging structured data where the "latest" version is the only value needed, a circular buffer can be used.

This has the benefit of ware-leveling the device in a predictable way.

# Concept

By breaking the memory space into Fixed-Size blocks (or "Slots" of `stride` length) these device can be predictably indexed and accessed.

Each "Slot" contains a "Header" and "Data".  The "Data" section is the used defined payload and is stored and retrieved transparently (no size information is stored and if the full "Data" section is not use it is up to the user to account for).

Each "Slot" also contains a "Header" consisting of the "Version" reference.

Each time a new "Slot" is written the current" Version" is incremented and written down into the "Slot".

When the data fills the buffer, it wraps around to the beginning (first "Slot") and overwrites that value (the "oldest" version).

Note that the `stride` defines the total size of teach "Slot".  Thus, each "Data" section that is available to use for the user is `stride - HEADER_SIZE` (where the current configured `HEADER_SIZE` is 32-bits / 4 bytes).  Thus a stride of `8` would result in `4` usable bytes for the user.



```
    ----------------------------------------------
    |  Ver Data  |  Ver Data  | ... |  Ver Data  |
    ----------------------------------------------
```

A similar implementation for [Arduino](https://github.com/RobTillaart/I2C_EEPROM/blob/master/I2C_eeprom_cyclic_store.h) commonly referenced, which should be compatible.


# Example

```javascript
const eeprom = /* ... */
const byteSize = (32 * 1024 / 8) /* eeprom length - 32K-bits */

// format first
await CyclicFS.format(eeprom, byteSize, metadata)
// initialize metadata token
const metadata = await CyclicFS.init(eeprom, byteSize, { stride: 8 })

// write data into FS
await CyclicFS.write(eeprom, metadata, Uint8Array.from([ 1, 2, 3, 4 ]))
await CyclicFS.write(eeprom, metadata, Uint8Array.from([ 5, 6, 7, 8 ]))
// ... etc
// last
await CyclicFS.write(eeprom, metadata, Uint8Array.from([ 42, 77, 00, 37 ]))

// read (the one and only) latest buffer
const ab = await CyclicFS.read(eeprom, metadata) // [ 42, 77, 00, 37 ]
```

# Options

Both `format` and `init` take in an `options` object which cna configure the FS's use of the EEPROMs memory.

- `baseAddress` start address in eeprom terms to create the FS (default: 0)
- `stride` size of each "Slot" (includes Header width) (default: 32)
- `littleEndian` "Header" byte ordering (does not effect user "Data") (default: false)

A "Slot" count is calculated as `byteLength / stride` (where `byteLength` is the allocated space for the FS, usually equal to the EEPROM total size)

Note: it is *highly* recommended to use `stride` that is a power-of-two, to align data to the EEPROM, though not required


# Example (partitioned)

It is not required to have the entire EEPROM memory use, and multiple (or alternative) FS instances can be run along side (assuming they also respect the partition space). Such as [EEFS](https://github.com/johntalton/eefs)

```javascript
const eeprom = /* ... */
const totalEEPROMSize = 64 * 1024 / 8 // 64K-bit
const halfSize = totalEEPROMSize / 2

// create two unique "partitions" of half of the total size with different options
const partition1Options = {
  baseAddress: 0,
  stride: 8, // 4 bytes of user Data
  littleEndian: true
}
const partition1Options = {
  baseAddress: halfSize,
  stride: 16 // 12 bytes of user Data
}

// format both
await CyclicFS.format(eeprom, halfSize, partition1Options)
await CyclicFS.format(eeprom, halfSize, partition2Options)

// initialize the two partitions
const metadataP1 = await CyclicFS.init(eeprom, halfSize, partition1Options)
const metadataP2 = await CyclicFS.init(eeprom, halfSize, partition2Options)

// write a bunch of data to each
await CyclicFS.write(eeprom, metadataP1, /* ... */)
await CyclicFS.write(eeprom, metadataP1, /* ... */)
await CyclicFS.write(eeprom, metadataP1, /* ... */)
// ...
await CyclicFS.write(eeprom, metadataP2, /* ... */) // write to partition 2
// ...
await CyclicFS.write(eeprom, metadataP1, /* ... */)
await CyclicFS.write(eeprom, metadataP1, /* ... */)

// read the two independent values
const p1LatestValue = await CycleFS.read(eeprom, metadataP1)
const p2LatestValue = await CycleFS.read(eeprom, metadataP2)

```