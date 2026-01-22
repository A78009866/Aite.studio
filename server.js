const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();

// زيادة حجم البيانات المسموح به لاستقبال الصور
app.use(express.json({ limit: '50mb' }));
app.use(cors());
app.use(express.static('public'));

// التحقق من وجود المتغيرات
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = process.env.REPO_OWNER;
const REPO_NAME = process.env.REPO_NAME;

if (!GITHUB_TOKEN || !REPO_OWNER || !REPO_NAME) {
    console.error("❌ CRITICAL ERROR: Environment variables are missing in Vercel settings.");
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 1. نقطة استلام طلب البناء
app.post('/api/build', async (req, res) => {
    console.log("📩 Received build request...");
    
    const { appName, packageName, appUrl, iconBase64 } = req.body;

    if (!appName || !packageName || !appUrl || !iconBase64) {
        console.error("❌ Missing Data");
        return res.status(400).json({ error: 'بيانات ناقصة: تأكد من تعبئة الحقول ورفع الصورة' });
    }

    try {
        console.log(`🚀 Triggering GitHub Action for: ${appName}`);
        
        await axios.post(
            `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/dispatches`,
            {
                event_type: 'build-apk',
                client_payload: {
                    app_name: appName,
                    package_name: packageName,
                    app_url: appUrl,
                    icon_data: iconBase64
                }
            },
            {
                headers: {
                    'Authorization': `token ${GITHUB_TOKEN}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            }
        );

        console.log("✅ GitHub Dispatch Sent Successfully");
        res.json({ success: true, message: 'تم إرسال الطلب بنجاح' });

    } catch (error) {
        console.error("❌ GitHub API Error:", error.response ? error.response.data : error.message);
        
        // إرسال تفاصيل الخطأ للواجهة
        const status = error.response ? error.response.status : 500;
        const msg = error.response && error.response.status === 401 
            ? "خطأ في الصلاحيات (401): تأكد من صحة التوكن في Vercel" 
            : "فشل الاتصال بـ GitHub، راجع سجلات السيرفر";
            
        res.status(status).json({ error: msg });
    }
});

// 2. نقطة فحص حالة البناء
app.get('/api/status', async (req, res) => {
    try {
        // جلب آخر عملية تشغيل (Workflow Run)
        const response = await axios.get(
            `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/runs?per_page=1`,
            {
                headers: { 'Authorization': `token ${GITHUB_TOKEN}` }
            }
        );

        if (response.data.workflow_runs.length > 0) {
            const lastRun = response.data.workflow_runs[0];
            res.json({
                status: lastRun.status, // queued, in_progress, completed
                conclusion: lastRun.conclusion, // success, failure
                html_url: lastRun.html_url
            });
        } else {
            res.json({ status: 'queued', conclusion: null });
        }

    } catch (error) {
        console.error("❌ Status Check Error:", error.message);
        res.status(500).json({ error: 'Could not fetch status' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
