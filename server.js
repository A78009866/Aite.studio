const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();

// --- التعديل هنا: زيادة الحد المسموح به إلى 200 ميجابايت ---
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ limit: '200mb', extended: true }));
app.use(cors());
app.use(express.static('public'));

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = process.env.REPO_OWNER;
const REPO_NAME = process.env.REPO_NAME;

if (!GITHUB_TOKEN || !REPO_OWNER || !REPO_NAME) {
    console.error("❌ CRITICAL ERROR: Environment variables are missing.");
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 1. نقطة استلام طلب البناء
app.post('/api/build', async (req, res) => {
    console.log("📩 Received build request...");
    
    const { appName, packageName, appUrl, iconBase64, permissions } = req.body;

    if (!appName || !packageName || !appUrl || !iconBase64) {
        console.error("❌ Missing Data");
        return res.status(400).json({ error: 'بيانات ناقصة' });
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
                    icon_base64: iconBase64,
                    use_camera: permissions?.camera || false,
                    use_mic: permissions?.mic || false,
                    use_location: permissions?.location || false,
                    use_files: permissions?.files || false
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
        const status = error.response ? error.response.status : 500;
        res.status(status).json({ error: "فشل الاتصال بـ GitHub" });
    }
});

// نقطة فحص الحالة
app.get('/api/status', async (req, res) => {
    try {
        const response = await axios.get(
            `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/runs?per_page=1`,
            { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } }
        );
        if (response.data.workflow_runs.length > 0) {
            const lastRun = response.data.workflow_runs[0];
            res.json({
                status: lastRun.status,
                conclusion: lastRun.conclusion,
                html_url: lastRun.html_url,
                run_id: lastRun.id 
            });
        } else {
            res.json({ status: 'queued', conclusion: null });
        }
    } catch (error) {
        res.status(500).json({ error: 'Could not fetch status' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
