require('dotenv').config();
const { Client } = require('discord.js-selfbot-v13');
const { MessageAttachment } = require('discord.js');
const { joinVoiceChannel, getVoiceConnection, createAudioPlayer, createAudioResource, StreamType, AudioPlayerStatus } = require('@discordjs/voice');
const play = require('play-dl');
const ytdl = require('@distube/ytdl-core');
const ffmpeg = require('ffmpeg-static');
const fs = require('fs');

process.env.FFMPEG_PATH = ffmpeg;
const players = new Map();

const client = new Client({
    checkUpdate: false,
});

// THÔNG TIN NGÂN HÀNG
const selectedBank = {
    id: process.env.BANK_ID || 'MB',
    account: process.env.ACCOUNT_NUMBER || '67123453172005',
    owner: process.env.OWNER_NAME || 'LE TRAN TIEN'
};

const PREFIX = '.';

client.on('ready', () => {
    console.log(`Self-bot đã sẵn sàng trên tài khoản: ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    // Chỉ xử lý tin nhắn của CHÍNH BẠN gửi đi
    if (message.author.id !== client.user.id || !message.content.startsWith(PREFIX)) return;

    const fullCommand = message.content.slice(PREFIX.length).trim();

    // Lệnh .stk
    if (fullCommand === 'stk') {
        await message.channel.send({
            files: ['./stk.jpg'] // Chỉ gửi file ảnh tĩnh
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
                files: ['./stk.jpg']
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
                joinVoiceChannel({
                    channelId: channel.id,
                    guildId: channel.guild.id,
                    adapterCreator: channel.guild.voiceAdapterCreator,
                    selfDeaf: false,
                    selfMute: false
                });
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

    // Lệnh .out (out sạch chanel)
    if (fullCommand === 'out') {
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
                selfDeaf: false,
                selfMute: false
            });

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

client.login(process.env.TOKEN);
