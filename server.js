const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cloudinary = require('cloudinary').v2;
const path = require('path');

// تحميل المتغيرات محلياً فقط (Vercel يقوم بذلك تلقائياً)
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// 1. إعدادات Cloudinary (تأكد من وجودها في Vercel)
// ==========================================
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// ==========================================
// 2. إعدادات السيرفر (توسيع الحدود للصور)
// ==========================================
app.use(cors());
// هذا السطر يحل مشكلة 413 Payload Too Large
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static('public'));

// ==========================================
// 3. نقطة الاتصال الرئيسية
// ==========================================
app.post('/api/build', async (req, res) => {
    console.log("📥 Received Request at /api/build");
    
    // طباعة مفاتيح البيانات المستلمة للتأكد من تطابقها مع الفرونت إند
    // سيظهر هذا في Vercel Logs
    console.log("🔑 Data Keys:", Object.keys(req.body));

    // استخراج البيانات
    const { app_name, package_name, icon_url } = req.body;

    // التحقق من المتغيرات البيئية (Environment Variables)
    if (!process.env.CIRRUS_TOKEN || !process.env.CIRRUS_REPO_ID) {
        console.error("❌ CRITICAL: Cirrus Env Variables Missing in Vercel!");
        return res.status(500).json({ error: "Server misconfiguration (Missing Cirrus Keys)" });
    }

    // التحقق من البيانات القادمة من المستخدم
    if (!app_name || !package_name || !icon_url) {
        console.error("❌ Invalid Input:", req.body);
        return res.status(400).json({ 
            error: "Missing required fields", 
            details: "Ensure app_name, package_name, and icon_url are sent." 
        });
    }

    try {
        let finalIconUrl = icon_url;

        // معالجة الصورة: إذا كانت Base64 نقوم برفعها
        if (icon_url.startsWith('data:image') || icon_url.length > 500) {
            console.log("🖼️ Detected Base64 Image. Uploading to Cloudinary...");
            
            if (!process.env.CLOUDINARY_CLOUD_NAME) {
                 return res.status(500).json({ error: "Cloudinary keys missing in Vercel" });
            }

            const uploadResponse = await cloudinary.uploader.upload(icon_url, {
                folder: "apk_builder_icons",
                resource_type: "image",
                public_id: `${package_name.replace(/\./g, '_')}_icon`
            });
            
            finalIconUrl = uploadResponse.secure_url;
            console.log("✅ Icon Uploaded:", finalIconUrl);
        }

        // إرسال الأمر لـ Cirrus CI
        console.log(`🚀 Triggering Build for ${app_name}...`);
        
        const graphqlQuery = {
            query: `
                mutation {
                    createRepositoryBuild(
                        input: {
                            repositoryId: "${process.env.CIRRUS_REPO_ID}",
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
                'Authorization': `Bearer ${process.env.CIRRUS_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        // التعامل مع أخطاء Cirrus
        if (response.data.errors) {
            console.error("❌ Cirrus API Error:", response.data.errors);
            return res.status(500).json({ error: "Cirrus CI rejected the request", details: response.data.errors });
        }

        const buildData = response.data.data.createRepositoryBuild.build;
        console.log(`✅ SUCCESS! Build ID: ${buildData.id}`);

        res.status(200).json({
            success: true,
            message: "Build started successfully",
            build_id: buildData.id,
            tracking_url: buildData.webUrl
        });

    } catch (error) {
        console.error("🔥 INTERNAL SERVER ERROR:", error.message);
        res.status(500).json({ error: "Internal Server Error", message: error.message });
    }
});

app.get('/', (req, res) => {
    res.send("APK Builder Server is Running 🚀");
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
