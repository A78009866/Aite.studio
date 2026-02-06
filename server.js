const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

// تحميل dotenv فقط إذا كنا في بيئة التطوير المحلية
// في Vercel المتغيرات موجودة تلقائياً فلا نحتاج لهذا السطر
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const app = express();
const PORT = process.env.PORT || 3000;

// استدعاء المتغيرات من بيئة Vercel
const CIRRUS_TOKEN = process.env.CIRRUS_TOKEN;
const REPO_ID = process.env.CIRRUS_REPO_ID;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// المسار تم تعديله ليطابق طلب الفرونت إند /api/build
app.post('/api/build', async (req, res) => {
    console.log("📥 New Build Request Received");

    // التحقق من وجود المفاتيح قبل البدء
    if (!CIRRUS_TOKEN || !REPO_ID) {
        console.error("❌ ERROR: Missing Environment Variables (CIRRUS_TOKEN or REPO_ID)");
        return res.status(500).json({ 
            error: 'Server Configuration Error: Missing API Tokens in Vercel Settings.' 
        });
    }

    const { app_name, package_name, icon_url } = req.body;

    // التحقق من البيانات القادمة من المستخدم
    if (!app_name || !package_name || !icon_url) {
        return res.status(400).json({ 
            error: 'Missing required fields: app_name, package_name, or icon_url' 
        });
    }

    try {
        // إعداد طلب GraphQL لـ Cirrus CI
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

        // إرسال الطلب
        console.log(`🚀 Triggering build for: ${app_name}`);
        const response = await axios.post('https://api.cirrus-ci.com/graphql', graphqlQuery, {
            headers: {
                'Authorization': `Bearer ${CIRRUS_TOKEN}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            }
        });

        // التحقق من رد Cirrus
        if (response.data.errors) {
            console.error('❌ Cirrus API Error:', JSON.stringify(response.data.errors));
            return res.status(500).json({ 
                error: 'Failed to trigger build on Cirrus CI', 
                details: response.data.errors 
            });
        }

        const buildData = response.data.data.createRepositoryBuild.build;
        console.log(`✅ Build Started Successfully! ID: ${buildData.id}`);

        // الرد بنجاح
        res.status(200).json({
            message: 'Build triggered successfully',
            build_id: buildData.id,
            tracking_url: buildData.webUrl,
            status: 'queued'
        });

    } catch (error) {
        console.error('❌ Server Internal Error:', error.message);
        // إعادة رسالة JSON دائماً لمنع خطأ Unexpected token A في المتصفح
        res.status(500).json({ 
            error: 'Internal Server Error', 
            details: error.message 
        });
    }
});

// الصفحة الرئيسية
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// تشغيل السيرفر
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
