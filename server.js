const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios'); // المكتبة الجديدة للاتصال بـ Cirrus
require('dotenv').config(); // يفضل استخدامه لحماية المفاتيح

const app = express();
const PORT = process.env.PORT || 3000;

// إعدادات Cirrus CI (احصل عليها من لوحة التحكم)
// يفضل وضع هذه القيم في ملف .env
const CIRRUS_TOKEN = process.env.CIRRUS_TOKEN || 'YOUR_CIRRUS_ACCESS_TOKEN'; 
const REPO_ID = process.env.CIRRUS_REPO_ID || 'YOUR_REPOSITORY_ID'; 

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.post('/build-apk', async (req, res) => {
    const { app_name, package_name, icon_url } = req.body;

    // 1. التحقق من صحة البيانات
    if (!app_name || !package_name || !icon_url) {
        return res.status(400).json({ 
            error: 'Missing required fields: app_name, package_name, or icon_url' 
        });
    }

    console.log(`🚀 Receiving Build Request for: ${app_name}`);

    try {
        // 2. تجهيز طلب GraphQL لـ Cirrus CI
        // هذا الكود يطلب من Cirrus بدء بناء جديد مع تمرير المتغيرات
        const graphqlQuery = {
            query: `
                mutation {
                    createRepositoryBuild(
                        input: {
                            repositoryId: "${REPO_ID}",
                            branch: "main",
                            environmentVariables: [
                                { name: "APP_NAME", value: "${app_name}" },
                                { name: "PACKAGE_NAME", value: "${package_name}" },
                                { name: "ICON_URL", value: "${icon_url}" }
                            ]
                        }
                    ) {
                        build {
                            id
                            status
                            webUrl
                        }
                    }
                }
            `
        };

        // 3. إرسال الطلب إلى Cirrus API
        const response = await axios.post('https://api.cirrus-ci.com/graphql', graphqlQuery, {
            headers: {
                'Authorization': `Bearer ${CIRRUS_TOKEN}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            }
        });

        // 4. التحقق من وجود أخطاء في الرد
        if (response.data.errors) {
            console.error('❌ Cirrus API Error:', response.data.errors);
            return res.status(500).json({ error: 'Failed to trigger build on Cirrus CI', details: response.data.errors });
        }

        const buildData = response.data.data.createRepositoryBuild.build;
        console.log(`✅ Build Started! ID: ${buildData.id}`);

        // 5. إرسال الرد للفرونت إند
        res.status(200).json({
            message: 'Build triggered successfully on Cirrus CI',
            build_id: buildData.id,
            tracking_url: buildData.webUrl,
            status: 'queued'
        });

    } catch (error) {
        console.error('❌ Server Error:', error.message);
        res.status(500).json({ 
            error: 'Internal Server Error',
            details: error.message 
        });
    }
});

// نقطة فحص بسيطة
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
