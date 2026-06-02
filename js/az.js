'use stric';
const { request } = require('undici');
const { load } = require('cheerio');

const loadContent = (html) => {
    try {
        const $ = load(html);
        const arrayDados = [];

        $('.relative.h-full').each((_, el) => {
            const nome = $(el).find('div.h-full.w-full > p').text();
            const link = $(el).find('div.sc-bdfBwQ a').attr('href');

            arrayDados.push({ nome, link });
        });

        return arrayDados;
    } catch (err) {
        throw err.message;
    }
};

const getGruposAZ = async () => {
    try {
        const { 
            body 
        } = await request('https://linktr.ee/alianca_az', {
            method: 'GET',
            headers: {
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36',
            },
        });

        const html = await body.text();
        return loadContent(html);
    } catch (err) {
        throw new Error(err);
    }
};

module.exports = getGruposAZ;
