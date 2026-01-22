const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();

// زيادة الحد المسموح به للبيانات لاستقبال الصور (50mb)
app.use(express.json({ limit: '50mb' }));
app.use(cors());
app.use(express.static('public'));

const GITHUB_TOKEN = process.env.GITHUB_TOKEN; 
const REPO_OWNER = process.env.REPO_OWNER; 
const REPO_NAME = process.env.REPO_NAME; 

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/api/build', async (req, res) => {
    // iconBase64: هو كود الصورة الذي سنرسله بدلاً من الرابط
    const { appName, packageName, appUrl, iconBase64 } = req.body;

    if (!appName || !packageName || !appUrl) {
        return res.status(400).json({ error: 'يرجى ملء جميع الحقول المطلوبة' });
    }

    try {
        await axios.post(
            `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/dispatches`,
            {
                event_type: 'build-apk',
                client_payload: {
                    app_name: appName,
                    package_name: packageName,
                    app_url: appUrl,
                    icon_data: iconBase64 // سنرسل البيانات الخام للصورة
                }
            },
            {
                headers: {
                    'Authorization': `token ${GITHUB_TOKEN}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            }
        );

        res.json({ success: true, message: 'تم استلام الطلب! جاري بناء التطبيق...' });

    } catch (error) {
        console.error(error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'فشل الاتصال بـ GitHub' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

