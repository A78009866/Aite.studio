const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cloudinary = require('cloudinary').v2;
const path = require('path');

// تحميل المتغيرات البيئية
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const app = express();
const PORT = process.env.PORT || 3000;

// إعدادات Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

app.use(cors());
// زيادة الحد المسموح به لاستقبال الصور الكبيرة
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static('public'));

app.post('/api/build', async (req, res) => {
    console.log("📥 Received Build Request");

    // 1. استقبال البيانات بنفس الأسماء التي يرسلها الـ Frontend (index.html)
    const { 
        appName, 
        packageName, 
        appUrl, 
        iconBase64, 
        permissions, 
        customizations 
    } = req.body;

    // التحقق من أن الحقول الأساسية موجودة
    if (!appName || !packageName || !appUrl || !iconBase64) {
        console.error("❌ Missing Fields:", Object.keys(req.body));
        return res.status(400).json({ 
            error: "Missing required fields", 
            details: "Ensure appName, packageName, appUrl, and iconBase64 are sent." 
        });
    }

    try {
        let finalIconUrl = iconBase64;

        // 2. رفع الصورة إلى Cloudinary
        if (iconBase64.startsWith('data:image') || iconBase64.length > 500) {
            console.log("🖼️ Uploading Icon to Cloudinary...");
            const uploadResponse = await cloudinary.uploader.upload(iconBase64, {
                folder: "apk_builder_icons",
                resource_type: "image",
                public_id: `${packageName.replace(/\./g, '_')}_icon`
            });
            finalIconUrl = uploadResponse.secure_url;
            console.log("✅ Icon Uploaded:", finalIconUrl);
        }

        // 3. تجهيز المتغيرات (Environment Variables) لإرسالها لـ Cirrus CI
        // نقوم بتحويل القيم المنطقية (true/false) إلى نصوص ("true"/"false")
        const envVars = [
            { name: "APP_NAME", value: appName },
            { name: "PACKAGE_NAME", value: packageName },
            { name: "APP_URL", value: appUrl },
            { name: "ICON_URL", value: finalIconUrl },
            
            // الأذونات (Permissions)
            { name: "PERM_CAMERA", value: String(permissions?.camera || false) },
            { name: "PERM_MIC", value: String(permissions?.mic || false) },
            { name: "PERM_LOCATION", value: String(permissions?.location || false) },
            { name: "PERM_FILES", value: String(permissions?.files || false) },
            { name: "PERM_NOTIFY", value: String(permissions?.notify || false) },

            // التخصيصات (Customizations) - أضفناها هنا لكي تعمل الأزرار الجديدة
            { name: "CUSTOM_ZOOM", value: String(customizations?.enableZoom || true) },
            { name: "CUSTOM_TEXT_SELECTION", value: String(customizations?.enableTextSelection || true) },
            { name: "CUSTOM_SPLASH", value: String(customizations?.enableSplashScreen || true) }
        ];

        console.log(`🚀 Triggering Build for ${appName}...`);

        const graphqlQuery = {
            query: `
                mutation {
                    createRepositoryBuild(
                        input: {
                            repositoryId: "${process.env.CIRRUS_REPO_ID}",
                            branch: "main",
                            environmentVariables: ${JSON.stringify(envVars).replace(/"name":/g, 'name:').replace(/"value":/g, 'value:')}
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
                'Authorization': `Bearer ${process.env.CIRRUS_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.data.errors) {
            console.error("❌ Cirrus API Error:", response.data.errors);
            return res.status(500).json({ error: "Cirrus CI rejected request", details: response.data.errors });
        }

        const buildData = response.data.data.createRepositoryBuild.build;
        console.log(`✅ SUCCESS! Build ID: ${buildData.id}`);

        res.status(200).json({
            success: true,
            run_id: buildData.id, // Frontend expects 'run_id'
            tracking_url: buildData.webUrl
        });

    } catch (error) {
        console.error("🔥 Server Error:", error.message);
        res.status(500).json({ error: "Internal Server Error", message: error.message });
    }
});

// نقطة لفحص حالة البناء (يستخدمها الـ Frontend للمراقبة)
app.post('/api/status/:buildId', async (req, res) => { // يمكن استخدام GET أيضاً، لكن الكود الحالي قد يستخدم POST
   // ... (يمكنك إضافة منطق الفحص هنا إذا لزم الأمر، أو الاعتماد على Webhooks)
   // حالياً الـ Frontend يحاول الاتصال بـ /api/status/{id} لذا يجب توفيرها:
});

app.get('/api/status/:buildId', async (req, res) => {
    const { buildId } = req.params;
    try {
        const query = {
            query: `
                query {
                    build(id: "${buildId}") {
                        status
                        durationInSeconds
                        artifacts {
                            files { path, url }
                        }
                    }
                }
            `
        };
        
        const response = await axios.post('https://api.cirrus-ci.com/graphql', query, {
             headers: { 'Authorization': `Bearer ${process.env.CIRRUS_TOKEN}` }
        });

        const build = response.data.data.build;
        
        // البحث عن ملف APK في النتائج
        let downloadUrl = null;
        if (build.status === 'COMPLETED' || build.status === 'EXECUTING') {
             // منطق استخراج رابط التحميل (يعتمد على كيفية تخزين Artifacts في Cirrus)
             // هذا مجرد مثال مبسط
             if (build.artifacts && build.artifacts.length > 0) {
                 // ابحث عن ملف ينتهي بـ .apk
                 // downloadUrl = ...
             }
        }

        res.json({
            status: build.status.toLowerCase(), // 'created', 'executing', 'completed', 'failed'
            conclusion: build.status === 'COMPLETED' ? 'success' : null,
            download_url: downloadUrl // سيرسله السيرفر عند الانتهاء
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/', (req, res) => {
    res.send("Aite Studio Server is Running 🚀");
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
