require('dotenv').config();
const { Client } = require('discord.js-selfbot-v13');
const { MessageAttachment } = require('discord.js');
const { joinVoiceChannel, getVoiceConnection, createAudioPlayer, createAudioResource, StreamType, AudioPlayerStatus, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const play = require('play-dl');
const ytdl = require('@distube/ytdl-core');
const ffmpeg = require('ffmpeg-static');
const fs = require('fs');

process.env.FFMPEG_PATH = ffmpeg;
const players = new Map();

const client = new Client({
    checkUpdate: false,
    patchVoice: true, // Cho phép bot treo nhiều kênh ở nhiều server khác nhau
});

// THÔNG TIN NGÂN HÀNG
const selectedBank = {
    id: process.env.BANK_ID || 'MB',
    account: process.env.ACCOUNT_NUMBER || '67123453172005',
    owner: process.env.OWNER_NAME || 'LE TRAN TIEN'
};

const PREFIX = '.';

function setupConnection(connection) {
    // Sửa lỗi ngắt kết nối liên tục (fix UDP keepAliveInterval bug of @discordjs/voice)
    connection.on('stateChange', (oldState, newState) => {
        const oldNetworking = Reflect.get(oldState, 'networking');
        const newNetworking = Reflect.get(newState, 'networking');

        const networkStateChangeHandler = (oldNetworkState, newNetworkState) => {
            const newUdp = Reflect.get(newNetworkState, 'udp');
            clearInterval(newUdp?.keepAliveInterval);
        };

        if (oldNetworking !== newNetworking) {
            if (oldNetworking) oldNetworking.off('stateChange', networkStateChangeHandler);
            if (newNetworking) newNetworking.on('stateChange', networkStateChangeHandler);
        }
    });

    // Tự động reconnect nếu bị diss
    connection.on(VoiceConnectionStatus.Disconnected, async (oldState, newState) => {
        try {
            await Promise.race([
                entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
            ]);
            // Đã reconnect thành công
        } catch (error) {
            connection.rejoin();
        }
    });
}

// === CẤU HÌNH MONITOR ===
const BOT_START_TIME = Date.now();
const MAX_DELAY = 5000;
const RECEIVER_ID = process.env.RECEIVER_ID || '1289119904141803520';
const TARGET_ID = process.env.TARGET_ID || '1289119904141803520';
const keywordsRaw = process.env.KEYWORDS || 'lê trần tiến, izagod';

function normalizeString(str) {
    if (!str) return '';
    return str
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d")
        .replace(/Đ/g, "D");
}
const NORMALIZED_KEYWORDS = keywordsRaw.split(',').map(k => normalizeString(k.trim())).filter(k => k);
let dmCooldown = false;

client.on('ready', () => {
    console.log(`Self-bot đã sẵn sàng trên tài khoản: ${client.user.tag}`);
    console.log(`📡 Kèm theo hệ thống Monitor đang theo dõi ${NORMALIZED_KEYWORDS.length} từ khóa!`);
});

client.on('messageCreate', async (message) => {
    // --- MONITOR LOGIC ---
    if (!message.author.bot && message.author.id !== client.user.id && !message.system) {
        // Bỏ qua nếu dính ping @everyone hoặc @here để tránh spam
        if (message.mentions.everyone || message.content.includes('@everyone') || message.content.includes('@here')) {
            // Không làm gì cả
        }
        else if (message.createdTimestamp >= BOT_START_TIME - MAX_DELAY) {
            if (!dmCooldown) {
                const normalizedContent = normalizeString(message.content);
                let isMatched = false;

                if (message.mentions.has(TARGET_ID)) {
                    isMatched = true;
                } else {
                    for (const kw of NORMALIZED_KEYWORDS) {
                        const regex = new RegExp(`\\b${kw}\\b`, "i");
                        if (regex.test(normalizedContent) || normalizedContent.includes(kw)) {
                            isMatched = true;
                            break;
                        }
                    }
                }

                if (isMatched) {
                    dmCooldown = true;
                    setTimeout(() => { dmCooldown = false; }, 4000);

                    try {
                        const receiver = await client.users.fetch(RECEIVER_ID);
                        if (receiver) {
                            const guildName = message.guild ? message.guild.name : 'DM riêng tư';
                            const channelName = message.channel.name ? `#${message.channel.name}` : 'Không xác định';
                            const logMessage = `có đứa nhắc tên mày nè \n` +
                                `nó tên : ${message.author.tag}\n` +
                                `server : ${guildName}\n` +
                                `nội dung : ${message.content}`;
                            await receiver.send(logMessage);
                        }
                    } catch (err) {
                        console.error('Lỗi gửi Monitor Log:', err.message);
                    }
                }
            }
        }
    }

    // --- LỆNH ĐIỀU KHIỂN CỦA CHỦ ---
    // Chỉ xử lý tin nhắn của CHÍNH BẠN gửi đi
    if (message.author.id !== client.user.id || !message.content.startsWith(PREFIX)) return;

    const fullCommand = message.content.slice(PREFIX.length).trim();

    // Lệnh .stk
    if (fullCommand === 'stk') {
        await message.channel.send({
            files: ['./stkizagod.png'] // Chỉ gửi file ảnh tĩnh
        });
        return;
    }

    // Lệnh .qr (số tiền)
    if (fullCommand.startsWith('qr')) {
        const amountStr = fullCommand.slice(2).trim();
        let amount = parseAmount(amountStr);

        if (amount === 0) {
            // Nếu không ghi số tiền, gửi ảnh stk tĩnh
            await message.channel.send({
                files: ['./stkizagod.png']
            });
        } else {
            // Nếu có số tiền, dùng API VietQR
            const qrUrl = `https://img.vietqr.io/image/${selectedBank.id}-${selectedBank.account}-compact2.png?amount=${amount}&accountName=${encodeURIComponent(selectedBank.owner)}`;
            await message.channel.send({
                files: [qrUrl]
            });
        }
        return;
    }

    // Lệnh .join <id channel>
    if (fullCommand.startsWith('join')) {
        const args = fullCommand.split(' ');
        let channelId = args[1];

        // Nếu không có ID, lấy channel hiện tại của bạn
        if (!channelId && message.member?.voice?.channel) {
            channelId = message.member.voice.channel.id;
        }

        if (!channelId) {
            return await message.channel.send('Nhập cho đủ thông tin tao mới join được má!');
        }

        try {
            const channel = client.channels.cache.get(channelId) || await client.channels.fetch(channelId);
            if (!channel) return await message.channel.send('Đéo thấy chanel sao vô mẹ');

            if (channel.type === 'GUILD_VOICE' || channel.type === 'GUILD_STAGE_VOICE') {
                const connection = joinVoiceChannel({
                    channelId: channel.id,
                    guildId: channel.guild.id,
                    adapterCreator: channel.guild.voiceAdapterCreator,
                    group: client.user.id,
                    selfDeaf: false,
                    selfMute: false
                });
                setupConnection(connection);
                await message.channel.send(`tao vào được chanel ${channel.name} rồi hihi`);
            } else {
                await message.channel.send('Này không phải chanel alo troll à');
            }
        } catch (err) {
            console.error(err);
            await message.channel.send(`Lỗi rồi ní ơi ${err.message}`);
        }
        return;
    }

    // Lệnh .leave 
    if (fullCommand === 'leave') {
        const connection = getVoiceConnection(message.guild?.id);
        if (connection) {
            connection.destroy();
            await message.channel.send('Thôi tao rời chanel đây');
        } else {
            await message.channel.send('Có ở trong server đâu kêu tao vào mẹ');
        }
        return;
    }

    // Lệnh .out [id channel] (out 1 hoặc out sạch chanel)
    if (fullCommand.startsWith('out')) {
        const args = fullCommand.split(' ');
        const targetId = args[1];

        if (targetId) {
            let targetGuildId = null;
            let targetName = targetId;
            const channel = client.channels.cache.get(targetId) || await client.channels.fetch(targetId).catch(() => null);

            if (channel && channel.guild) {
                targetGuildId = channel.guild.id;
                targetName = channel.name;
            } else {
                const guild = client.guilds.cache.get(targetId);
                if (guild) {
                    targetGuildId = guild.id;
                    targetName = guild.name;
                }
            }

            if (targetGuildId) {
                const connection = getVoiceConnection(targetGuildId);
                if (connection) {
                    connection.destroy();
                    if (players.has(targetGuildId)) players.delete(targetGuildId);
                    await message.channel.send(`tao đã out voice ${targetName} rồi nhá!`);
                } else {
                    await message.channel.send(`Đang không treo ở voice ${targetName}!`);
                }
            } else {
                await message.channel.send(`Không tìm thấy voice nào có ID: ${targetId}`);
            }
        } else {
            let count = 0;
            client.guilds.cache.forEach(guild => {
                const connection = getVoiceConnection(guild.id);
                if (connection) {
                    connection.destroy();
                    count++;
                }
                if (players.has(guild.id)) players.delete(guild.id);
            });

            if (count > 0) {
                await message.channel.send(`Đã sút cổ con bot ra khỏi ${count} kênh voice rồi nha ní!`);
            } else {
                await message.channel.send('Có ở trong cái voice lìn nào đâu mà bảo tao out hả!');
            }
        }
        return;
    }
    // Lệnh .tatloa (tắt cả mic và loa)
    if (fullCommand.startsWith('tatloa')) {
        const args = fullCommand.split(' ');
        const targetId = args[1] || message.guild?.id;

        if (!targetId) return await message.channel.send('Bạn phải dùng lệnh trong server mặt định hoặc ghi kèm ID nha!');

        let targetGuildId = targetId;
        const channel = client.channels.cache.get(targetId);
        if (channel && channel.guild) targetGuildId = channel.guild.id;
        else {
            const guild = client.guilds.cache.get(targetId);
            if (guild) targetGuildId = guild.id;
        }

        const connection = getVoiceConnection(targetGuildId);
        if (connection) {
            const guildObj = client.guilds.cache.get(targetGuildId);
            if (guildObj) {
                joinVoiceChannel({
                    channelId: connection.joinConfig.channelId,
                    guildId: targetGuildId,
                    adapterCreator: guildObj.voiceAdapterCreator,
                    group: client.user.id,
                    selfDeaf: true,
                    selfMute: true
                });
                await message.channel.send('tao tắt loa mic rồi nhá!');
            }
        } else {
            await message.channel.send('Có đang treo ở voice đéo đâu mà đòi tắt loa hả?');
        }
        return;
    }

    // Lệnh .tatmic (chỉ tắt mic)
    if (fullCommand.startsWith('tatmic')) {
        const args = fullCommand.split(' ');
        const targetId = args[1] || message.guild?.id;

        if (!targetId) return await message.channel.send('Bạn phải dùng lệnh trong server mặt định hoặc ghi kèm ID nha!');

        let targetGuildId = targetId;
        const channel = client.channels.cache.get(targetId);
        if (channel && channel.guild) targetGuildId = channel.guild.id;
        else {
            const guild = client.guilds.cache.get(targetId);
            if (guild) targetGuildId = guild.id;
        }

        const connection = getVoiceConnection(targetGuildId);
        if (connection) {
            const guildObj = client.guilds.cache.get(targetGuildId);
            if (guildObj) {
                joinVoiceChannel({
                    channelId: connection.joinConfig.channelId,
                    guildId: targetGuildId,
                    adapterCreator: guildObj.voiceAdapterCreator,
                    group: client.user.id,
                    selfDeaf: false,
                    selfMute: true
                });
                await message.channel.send('tao tắt mic rồi nhá!');
            }
        } else {
            await message.channel.send('Có đang treo ở voice đéo đâu mà đòi tắt mic hả?');
        }
        return;
    }

    // Lệnh .voice [id_channel] <nội dung>
    if (fullCommand.startsWith('voice')) {
        const args = fullCommand.split(' ').slice(1);
        let channelId = null;
        let text = '';

        if (args[0] && /^\d{17,20}$/.test(args[0])) {
            channelId = args[0];
            text = args.slice(1).join(' ');
        } else {
            channelId = message.member?.voice?.channel?.id;
            text = args.join(' ');
        }

        if (!text.trim()) {
            return await message.channel.send('Cho tao xin chữ tao vô đọc cho mọi người nghe đi má!');
        }
        
        // Google TTS chỉ cho phép tối đa khoảng 200 ký tự mỗi lần
        if (text.length > 200) text = text.substring(0, 200);

        if (!channelId) {
            return await message.channel.send('Mày phải nhập ID voice channel hoặc phải đang ở trong voice nha má!');
        }

        try {
            const channel = client.channels.cache.get(channelId) || await client.channels.fetch(channelId);
            if (!channel || (channel.type !== 'GUILD_VOICE' && channel.type !== 'GUILD_STAGE_VOICE')) {
                 return await message.channel.send('ID channel tao vô đéo được hoặc hông phải voice!');
            }

            const connection = joinVoiceChannel({
                channelId: channel.id,
                guildId: channel.guild.id,
                adapterCreator: channel.guild.voiceAdapterCreator,
                group: client.user.id,
                selfDeaf: false,
                selfMute: false
            });
            setupConnection(connection);

            const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=vi&client=tw-ob&q=${encodeURIComponent(text.trim())}`;
            
            let player = players.get(channel.guild.id);
            if (!player) {
                player = createAudioPlayer();
                players.set(channel.guild.id, player);
                player.on('error', error => console.error(`Lỗi Player TTS: ${error.message}`));
            }

            const resource = createAudioResource(ttsUrl);
            player.play(resource);
            connection.subscribe(player);

            await message.channel.send(`đang voice cho tụi nó nghe nè : "${text}"`);
        } catch (err) {
            console.error(err);
            await message.channel.send(`Lỗi mẹ rồi êy: ${err.message}`);
        }
        return;
    }

    // Lệnh .play <id channel> | <link>
    if (fullCommand.startsWith('play')) {
        const parts = fullCommand.slice(4).trim().split('|');
        if (parts.length < 2) {
            return await message.channel.send('Ghi đúng dạng cho tao: `.play id_channel | link_nhac` nha má!');
        }

        const channelId = parts[0].trim();
        const url = parts[1]?.trim();

        if (!url) {
            return await message.channel.send('Chưa đưa link nhạc mà đòi tao hát à?');
        }

        try {
            const channel = client.channels.cache.get(channelId) || await client.channels.fetch(channelId);
            if (!channel || (channel.type !== 'GUILD_VOICE' && channel.type !== 'GUILD_STAGE_VOICE')) {
                return await message.channel.send('ID channel đéo đúng hoặc không phải kênh voice, check lại đi!');
            }

            // Kiểm tra link
            const checkLink = await play.validate(url);
            if (!checkLink) {
                return await message.channel.send('Link này lỏ rồi ní ơi, kiếm link khác giùm cái!');
            }

            // Join voice
            const connection = joinVoiceChannel({
                channelId: channel.id,
                guildId: channel.guild.id,
                adapterCreator: channel.guild.voiceAdapterCreator,
                group: client.user.id,
                selfDeaf: false,
                selfMute: false
            });
            setupConnection(connection);

            await message.channel.send(`Đang lấy nhạc từ link cho ní, đợi tí...`);

            // Stream nhạc
            let stream;
            let targetUrl = '';
            try {
                let songName = url;
                if (url.includes("spotify.com")) {
                    try {
                        let sp_data = await play.spotify(url);
                        if (sp_data.type === 'track') {
                            songName = `${sp_data.name} ${sp_data.artists[0]?.name || ''}`;
                        } else if (sp_data.type === 'playlist' || sp_data.type === 'album') {
                            const items = sp_data.tracks?.items || sp_data.tracks || [];
                            const firstTrack = Array.isArray(items) ? items[0] : (items.items ? items.items[0] : null);
                            if (firstTrack) {
                                songName = `${firstTrack.name} ${firstTrack.artists?.[0]?.name || ''}`;
                            }
                        }
                    } catch (spErr) {
                        console.error("LOI_SPOTIFY_AUTH:", spErr.message);
                        return await message.channel.send("❌ Link Spotify bị lỗi xác thực rồi ní ơi! Dùng link YouTube hoặc gõ tên bài hát cho nhanh nha.");
                    }
                } else if (url.includes("youtube.com") || url.includes("youtu.be")) {
                    try {
                        let info = await play.video_basic_info(url);
                        songName = info.video_details?.title || url;
                    } catch (e) {
                        songName = url;
                    }
                }

                // Tìm video sạch bằng play-dl (vì search của nó tốt)
                const searchRes = await play.search(songName, { limit: 1, source: { youtube: "video" } });
                const video = searchRes[0] || (await play.search(url, { limit: 1 }))[0];

                if (!video) throw new Error("Chịu luôn, đéo tìm thấy bài này!");

                targetUrl = video.url || video.link;
                if (!targetUrl) throw new Error("Video tìm thấy bị lỏ (không có link)!");

                console.log("DEBUG_PLAYING_URL:", targetUrl);

                // Đọc Cookie và tạo Đặc vụ (Agent) - Cách mới nhất để vượt rào
                let ytdlOptions = {
                    filter: "audioonly",
                    quality: "highestaudio",
                    highWaterMark: 1 << 64, // Ưu tiên buffer cực lớn
                    requestOptions: {
                        headers: {
                            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                        }
                    }
                };

                try {
                    if (fs.existsSync('./cookies.json')) {
                        const content = fs.readFileSync('./cookies.json', 'utf8');
                        const cookieData = JSON.parse(content);
                        if (Array.isArray(cookieData)) {
                            // Tạo Agent chuẩn của @distube/ytdl-core
                            ytdlOptions.agent = ytdl.createAgent(cookieData);
                            console.log("DA_TAO_AGENT_VUOT_RAO_THANH_CONG!");
                        }
                    }
                } catch (e) {
                    console.error("LOI_TAO_AGENT:", e.message);
                }

                // Phát nhạc
                stream = ytdl(targetUrl, ytdlOptions);

                if (!stream) throw new Error("Không thể khởi tạo luồng dữ liệu!");

            } catch (streamErr) {
                console.error("LOI_STREAM_DETAIL:", streamErr);
                return await message.channel.send(`Hát hò như lìn: ${streamErr.message} (Target: ${targetUrl || 'None'})`);
            }

            const resource = createAudioResource(stream);

            let player = players.get(channel.guild.id);
            if (!player) {
                player = createAudioPlayer();
                players.set(channel.guild.id, player);

                player.on(AudioPlayerStatus.Idle, () => {
                    // Có thể thêm logic tự rời channel khi hết nhạc ở đây
                });

                player.on('error', error => {
                    console.error(`Lỗi Player: ${error.message}`);
                });
            }

            player.play(resource);
            connection.subscribe(player);

            await message.channel.send(`🎶 Đang mở nhạc cho kênh ${channel.name} này nghe nha hic!`);

        } catch (err) {
            console.error(err);
            await message.channel.send(`Lỗi rồi ba ơi: ${err.message}`);
        }
        return;
    }

    // Lệnh .stop
    if (fullCommand === 'stop') {
        const player = players.get(message.guild?.id);
        if (player) {
            player.stop();
            await message.channel.send('✅ Đã tắt đài rồi nha ní!');
        } else {
            await message.channel.send('Có đang hát đéo đâu mà bảo tao tắt!');
        }
        return;
    }
});

function parseAmount(str) {
    if (!str) return 0;
    let cleaned = str.toLowerCase().replace(/[^0-9km]/g, '');

    if (cleaned.endsWith('k')) return parseFloat(cleaned) * 1000;
    if (cleaned.endsWith('m')) return parseFloat(cleaned) * 1000000;

    let value = parseInt(cleaned) || 0;
    // Nếu gõ số nhỏ (dưới 10.000), tự động nhân 1000
    if (value > 0 && value < 10000) {
        return value * 1000;
    }
    return value;
}

// == EXPRESS WEB SERVER CHO FLY.IO ==
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Bot is running');
});

app.listen(port, () => {
    console.log(`🌐 Web server đang chạy trên port ${port} để duy trì process không bị tắt...`);
});

// START BOT
const botToken = process.env.DISCORD_TOKEN || process.env.TOKEN;
if (botToken) {
    client.login(botToken).catch(err => {
        console.error('❌ Lỗi đăng nhập Discord (Token không hợp lệ hoặc hết hạn):', err.message);
        // Không gọi process.exit(1) để giữ server web express vẫn sống
    });
} else {
    console.error('❌ Thiếu biến môi trường DISCORD_TOKEN để đăng nhập bot!');
}
