const fs = require('fs')
const path = require('path')
const axios = require('axios')

async function upscale(imageInput) {
    try {
        let buffer, ext;
        
        if (typeof imageInput === 'string') {
            buffer = fs.readFileSync(imageInput);
            ext = path.extname(imageInput).slice(1) || 'bin';
        } else if (Buffer.isBuffer(imageInput)) {
            buffer = imageInput;
            ext = 'jpg';
        } else {
            throw new Error('Invalid input type. Expected file path or Buffer.');
        }

        const mime = ext === 'png' ? 'image/png' : 
                     ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 
                     'application/octet-stream';
        
        const fileName = Math.random().toString(36).slice(2, 8) + '.' + ext;

        
        const { data } = await axios.post(
            "https://pxpic.com/getSignedUrl",
            { folder: "uploads", fileName },
            { headers: { "Content-Type": "application/json" } }
        );

        
        await axios.put(data.presignedUrl, buffer, {
            headers: { "Content-Type": mime }
        });

        
        const imageUrl = "https://files.fotoenhancer.com/uploads/" + fileName;
        const params = new URLSearchParams({
            imageUrl,
            targetFormat: 'png',
            needCompress: 'no',
            imageQuality: '100',
            compressLevel: '6',
            fileOriginalExtension: 'png',
            aiFunction: 'upscale',
            upscalingLevel: ''
        });

        const { data: apiResponse } = await axios.post(
            "https://pxpic.com/callAiFunction",
            params.toString(),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'Mozilla/5.0 (Android 10; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0',
                    'accept-language': 'id-ID'
                }
            }
        );
          //sla, resultado da imagi?
        const imageRes = await axios.get(apiResponse.resultImageUrl, {
            responseType: 'arraybuffer'
        });

        return {
            success: true,
            data: {
                image: Buffer.from(imageRes.data),
                imageUrl: apiResponse.resultImageUrl,
                size: formatSize(imageRes.data.length)
            }
        };
    } catch (error) {
        console.error('Upscale error:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

function formatSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    
    return `${size.toFixed(1)}${units[unitIndex]}`;
}

module.exports = upscale;