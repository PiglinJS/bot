/*
MIT License

Copyright (c) 2024 PiglinJS

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
const net = require('net');
const crypto = require('crypto');

const HOST = 'serverip';
const PORT = 25565;
const USERNAME = 'LOL';

function writeVarInt(value) {
    let buffer = Buffer.alloc(5);
    let index = 0;
    do {
        let temp = value & 0b01111111;
        value >>>= 7;
        if (value !== 0) {
            temp |= 0b10000000;
        }
        buffer[index++] = temp;
    } while (value !== 0);
    return buffer.slice(0, index);
}

function createPacket(packetId, data) {
    const packetIdBuffer = writeVarInt(packetId);
    const lengthBuffer = writeVarInt(packetIdBuffer.length + data.length);
    return Buffer.concat([lengthBuffer, packetIdBuffer, data]);
}

function readVarInt(buffer) {
    let value = 0;
    let length = 0;
    let currentByte;

    do {
        currentByte = buffer[length];
        value |= (currentByte & 0b01111111) << (7 * length);
        length++;
        if (length > 5) {
            throw new Error("VarInt is too big");
        }
    } while ((currentByte & 0b10000000) != 0);

    return { value, length };
}

const client = new net.Socket();

let loginSuccess = false;
let compressionThreshold = -1;

client.connect(PORT, HOST, () => {
    console.log('Connected to server');

    // Handshake packet
    const handshakeData = Buffer.concat([
        writeVarInt(47), // Protocol version for 1.8.9
        Buffer.from([HOST.length, ...Buffer.from(HOST)]), // Server address
        Buffer.from([PORT >> 8, PORT & 0xFF]), // Port
        writeVarInt(2) // Next state (2 for login)
    ]);
    client.write(createPacket(0x00, handshakeData));

    // Login start packet
    const loginStartData = Buffer.concat([
        Buffer.from([USERNAME.length, ...Buffer.from(USERNAME)])
    ]);
    client.write(createPacket(0x00, loginStartData));
});

let buffer = Buffer.alloc(0);

client.on('data', (data) => {
    buffer = Buffer.concat([buffer, data]);

    while (buffer.length > 0) {
        try {
            const { value: length, length: lengthSize } = readVarInt(buffer);
            if (buffer.length < length + lengthSize) break;

            const packet = buffer.slice(lengthSize, length + lengthSize);
            buffer = buffer.slice(length + lengthSize);

            const { value: packetId } = readVarInt(packet);

            console.log(`Received packet ID: 0x${packetId.toString(16)}`);

            // Handle different packet types
            switch (packetId) {
                case 0x00: // Keep Alive
                    if (loginSuccess) {
                        const keepAliveId = packet.readBigInt64BE(1);
                        client.write(createPacket(0x00, Buffer.from(keepAliveId.toString(16).padStart(16, '0'), 'hex')));
                        console.log('Responded to Keep Alive');
                    }
                    break;
                case 0x02: // Login Success
                    console.log('Login successful');
                    loginSuccess = true;
                    // Send client settings
                    const clientSettings = Buffer.concat([
                        Buffer.from([0x02]), // Locale length
                        Buffer.from('en'),   // Locale
                        Buffer.from([0x02]), // View distance
                        Buffer.from([0x00]), // Chat mode
                        Buffer.from([0x01]), // Chat colors
                        Buffer.from([0x7F]), // Displayed skin parts
                        Buffer.from([0x01])  // Main hand (1 for right)
                    ]);
                    client.write(createPacket(0x15, clientSettings));
                    break;
                case 0x03: // Set Compression
                    compressionThreshold = packet.readInt32BE(1);
                    console.log(`Compression threshold set to ${compressionThreshold}`);
                    break;
                case 0x40: // Disconnect
                    const reason = packet.toString('utf8', 1);
                    console.log('Disconnected by server:', reason);
                    client.destroy();
                    process.exit();
                    break;
                default:
                    console.log(`Unhandled packet ID: 0x${packetId.toString(16)}`);
            }
        } catch (error) {
            console.error('Error parsing packet:', error);
            buffer = buffer.slice(1); // Skip one byte and try again
        }
    }
});

client.on('close', () => {
    console.log('Connection closed');
});

client.on('error', (err) => {
    console.error('Error:', err);
});

// Keep the script running
process.on('SIGINT', () => {
    console.log('Bot is shutting down...');
    client.destroy();
    process.exit();
});
