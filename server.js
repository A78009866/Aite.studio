const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cloudinary = require('cloudinary').v2; // استدعاء مكتبة Cloudinary
const path = require('path');

// تحميل dotenv فقط في البيئة المحلية
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const app = express();
const PORT = process.env.PORT || 3000;

// ========================================================
// 1. إعدادات Cloudinary (تأكد من إضافتها في Vercel)
// ========================================================
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// ========================================================
// 2. إعدادات السيرفر (زيادة الحجم لـ 50 ميجا)
// ========================================================
app.use(cors());
// هذا هو الحل الجذري لمشكلة Payload Too Large
app.use(express.json({ limit: '50mb' })); 
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static('public'));

// استدعاء متغيرات Cirrus
const CIRRUS_TOKEN = process.env.CIRRUS_TOKEN;
const REPO_ID = process.env.CIRRUS_REPO_ID;

app.post('/api/build', async (req, res) => {
    console.log("📥 New Build Request Received");

    // التحقق من وجود كل المفاتيح الضرورية
    if (!CIRRUS_TOKEN || !REPO_ID || !process.env.CLOUDINARY_CLOUD_NAME) {
        console.error("❌ ERROR: Missing Environment Variables");
        return res.status(500).json({ 
            error: 'Server Config Error: Please check Vercel Environment Variables (Cirrus & Cloudinary).' 
        });
    }

    // استقبال البيانات (لاحظ: icon_url هنا قد يحتوي على Base64)
    let { app_name, package_name, icon_url } = req.body;

    if (!app_name || !package_name || !icon_url) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        let finalIconUrl = icon_url;

        // ========================================================
        // 3. رفع الصورة إلى Cloudinary (إذا كانت Base64)
        // ========================================================
        // نتحقق: هل النص طويل جداً ويبدأ بـ data:image؟ إذن هو صورة خام
        if (icon_url.length > 500 || icon_url.startsWith('data:image')) {
            console.log("🖼️  Uploading Icon to Cloudinary...");
            try {
                const uploadResponse = await cloudinary.uploader.upload(icon_url, {
                    folder: "apk-builder-icons",
                    public_id: `${package_name.replace(/\./g, '_')}_icon`,
                    overwrite: true,
                    resource_type: "image"
                });
                finalIconUrl = uploadResponse.secure_url; // الرابط الجديد القصير
                console.log(`✅ Icon Uploaded: ${finalIconUrl}`);
            } catch (uploadError) {
                console.error("❌ Cloudinary Upload Failed:", uploadError.message);
                return res.status(500).json({ error: 'Failed to upload icon image', details: uploadError.message });
            }
        } else {
            console.log("ℹ️  Using provided URL directly (no upload needed).");
        }

        // ========================================================
        // 4. إرسال الرابط الجديد إلى Cirrus CI
        // ========================================================
        console.log(`🚀 Triggering Cirrus Build for: ${app_name}`);
        
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
                                { name: "ICON_URL", value: "${finalIconUrl}" } 
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

        const response = await axios.post('https://api.cirrus-ci.com/graphql', graphqlQuery, {
            headers: {
                'Authorization': `Bearer ${CIRRUS_TOKEN}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            }
        });

        if (response.data.errors) {
            console.error('❌ Cirrus API Error:', JSON.stringify(response.data.errors));
            return res.status(500).json({ error: 'Failed to trigger build on Cirrus CI', details: response.data.errors });
        }

        const buildData = response.data.data.createRepositoryBuild.build;
        console.log(`✅ Build Queued! ID: ${buildData.id}`);

        res.status(200).json({
            message: 'Build started successfully',
            build_id: buildData.id,
            tracking_url: buildData.webUrl,
            status: 'queued',
            icon_processed: finalIconUrl
        });

    } catch (error) {
        console.error('❌ Server Internal Error:', error.message);
        res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
});

// الصفحة الرئيسية
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
