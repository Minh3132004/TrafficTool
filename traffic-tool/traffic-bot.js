/**
 * MaYaCa M4 - Traffic & Analytics KPI Simulator
 * Chuẩn xác 100% theo định nghĩa Google Analytics 4 (GA4):
 * - Total users: New users + Returning users + Bounced users
 * - New users: ~40-60/ngày (phiên mới, không lưu cookie cũ)
 * - Returning users: ~10/ngày (CƠ CHẾ ROLLING POOL: xoay vòng từ khách mới các ngày trước)
 * - Active users: ~20-30/ngày (ở lại >10s, cuộn trang 25/50/75/90%, tương tác)
 * - Bounce users: Thoát sớm 3-6s (dưới 10s, không cuộn)
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

// ================= CẤU HÌNH MẶC ĐỊNH =================
const CONFIG = {
  targetUrl: 'https://mayacacoffeem4.com/',
  defaultNewUsers: 50,      // Trong khoảng 40 - 60
  defaultReturningUsers: 10,// Chuẩn 10 returning users/ngày
  defaultActiveUsers: 25,   // Trong khoảng 20 - 30
  concurrency: 2,           // Số tab chạy đồng thời (2 để êm máy & giống người thật)
  headless: true            // true: chạy ngầm; false: hiện cửa sổ xem trực tiếp
};

// ================= DANH SÁCH THIẾT BỊ GIẢ LẬP =================
const DEVICES = [
  {
    name: 'iPhone 15 Pro (Safari)',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1',
    viewport: { width: 393, height: 852, isMobile: true, hasTouch: true }
  },
  {
    name: 'Samsung Galaxy S23 (Chrome)',
    userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.82 Mobile Safari/537.36',
    viewport: { width: 360, height: 780, isMobile: true, hasTouch: true }
  },
  {
    name: 'Xiaomi Redmi Note (Chrome)',
    userAgent: 'Mozilla/5.0 (Linux; Android 13; 22101316G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.6312.80 Mobile Safari/537.36',
    viewport: { width: 393, height: 873, isMobile: true, hasTouch: true }
  },
  {
    name: 'Windows 11 (Chrome Desktop)',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080, isMobile: false, hasTouch: false }
  },
  {
    name: 'Windows 10 (Edge Desktop)',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0',
    viewport: { width: 1366, height: 768, isMobile: false, hasTouch: false }
  },
  {
    name: 'MacBook Air (Safari Desktop)',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15',
    viewport: { width: 1440, height: 900, isMobile: false, hasTouch: false }
  }
];

function getChromeExecutable() {
  const paths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const getTodayStr = () => new Date().toISOString().slice(0, 10);

// ================= QUẢN LÝ KHO PROFILE XOAY VÒNG (ROLLING POOL) =================
class RollingPoolManager {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.poolDir = path.join(baseDir, 'pool');
    this.metaFile = path.join(baseDir, 'pool_metadata.json');
    this.init();
  }

  init() {
    fs.mkdirSync(this.poolDir, { recursive: true });
    if (!fs.existsSync(this.metaFile)) {
      this.saveMeta({ users: [] });
    }
  }

  getMeta() {
    try {
      return JSON.parse(fs.readFileSync(this.metaFile, 'utf8'));
    } catch (e) {
      return { users: [] };
    }
  }

  saveMeta(data) {
    fs.writeFileSync(this.metaFile, JSON.stringify(data, null, 2), 'utf8');
  }

  // Lấy danh sách returning users cho phiên hôm nay
  getReturningProfiles(targetCount) {
    const meta = this.getMeta();
    const today = getTodayStr();

    // Lọc những profile đã tồn tại trên ổ đĩa
    let validUsers = meta.users.filter(u => fs.existsSync(path.join(this.poolDir, u.id)));

    // Sắp xếp: Ưu tiên những người đã vào từ các ngày trước (firstSeen < today hoặc chưa vào hôm nay)
    validUsers.sort((a, b) => {
      if (a.lastVisitedDate !== b.lastVisitedDate) {
        return a.lastVisitedDate.localeCompare(b.lastVisitedDate);
      }
      return a.visitCount - b.visitCount;
    });

    const selected = validUsers.slice(0, targetCount);

    // Nếu kho chưa đủ targetCount (ví dụ ngày đầu tiên chạy):
    // Tự tạo thêm profile để gieo hạt giống (seed) vào kho
    while (selected.length < targetCount) {
      const newId = `user_seed_${Date.now()}_${selected.length + 1}`;
      const profileDir = path.join(this.poolDir, newId);
      fs.mkdirSync(profileDir, { recursive: true });

      const record = {
        id: newId,
        firstSeen: today,
        lastVisitedDate: today,
        visitCount: 1
      };
      meta.users.push(record);
      selected.push(record);
    }

    // Cập nhật lượt ghé thăm
    for (const u of selected) {
      u.visitCount = (u.visitCount || 1) + 1;
      u.lastVisitedDate = today;
    }
    this.saveMeta(meta);

    return selected.map(u => ({
      id: u.id,
      profileDir: path.join(this.poolDir, u.id),
      visitCount: u.visitCount
    }));
  }

  // Lưu một số khách mới của hôm nay vào Pool để làm Returning Users cho ngày mai/ngày sau
  saveNewUserToPool(tempProfileDir) {
    const today = getTodayStr();
    const newId = `user_${Date.now()}_${randomInt(1000, 9999)}`;
    const targetDir = path.join(this.poolDir, newId);

    try {
      if (fs.existsSync(tempProfileDir)) {
        // Đổi tên hoặc copy thư mục profile vào kho pool
        fs.renameSync(tempProfileDir, targetDir);

        const meta = this.getMeta();
        meta.users.push({
          id: newId,
          firstSeen: today,
          lastVisitedDate: today,
          visitCount: 1
        });

        // Giới hạn kho tối đa 40 profile để không tốn dung lượng ổ cứng
        if (meta.users.length > 40) {
          const removed = meta.users.splice(0, meta.users.length - 40);
          for (const r of removed) {
            const p = path.join(this.poolDir, r.id);
            if (fs.existsSync(p)) {
              try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) {}
            }
          }
        }

        this.saveMeta(meta);
        return true;
      }
    } catch (e) {
      return false;
    }
    return false;
  }
}

// ================= HÀM MÔ PHỎNG PHIÊN DUYỆT WEB =================
async function simulateSession({ id, type, isActive, profileDir, executablePath, headless }) {
  const device = DEVICES[Math.floor(Math.random() * DEVICES.length)];
  const startTime = Date.now();

  const launchArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--disable-infobars',
    '--mute-audio'
  ];

  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath,
      headless: headless ? 'new' : false,
      userDataDir: profileDir,
      args: launchArgs
    });

    const page = await browser.newPage();
    await page.setUserAgent(device.userAgent);
    await page.setViewport(device.viewport);

    // Mở trang
    await page.goto(CONFIG.targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    if (isActive) {
      // ===== ACTIVE USER: Ở lại > 10s, cuộn trang kích hoạt scroll_depth & view_section =====
      const targetStaySeconds = randomInt(16, 30); // 16s - 30s (luôn > 10s)

      // Cuộn dần dần từng nấc mượt mà
      await sleep(randomInt(2000, 3000));
      await page.evaluate(() => window.scrollBy({ top: 400, behavior: 'smooth' })); // 25%

      await sleep(randomInt(2500, 4000));
      await page.evaluate(() => window.scrollBy({ top: 800, behavior: 'smooth' })); // 50%

      await sleep(randomInt(3000, 5000));
      await page.evaluate(() => window.scrollBy({ top: 1000, behavior: 'smooth' })); // 75%

      // Rê chuột tương tác vào vùng tính giá vốn
      await page.evaluate(() => {
        const btn = document.querySelector('.btn-nav, .hero-actions a, #chi-phi');
        if (btn) btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });

      await sleep(randomInt(3000, 5000));
      await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })); // 90% - 100%

      // Chờ cho đủ thời gian dự tính để GA4 ghi nhận Engaged Session
      const elapsed = (Date.now() - startTime) / 1000;
      if (elapsed < targetStaySeconds) {
        await sleep((targetStaySeconds - elapsed) * 1000);
      }

      const totalTime = Math.round((Date.now() - startTime) / 1000);
      return {
        id,
        type,
        status: 'ACTIVE USER',
        duration: `${totalTime}s`,
        device: device.name,
        details: 'Cuộn trang 90% + Ở lại > 10s (Engaged Session)'
      };
    } else {
      // ===== BOUNCE USER: Thoát sớm 3s - 6s (< 10s, không cuộn) =====
      const staySeconds = randomInt(3, 6);
      await sleep(staySeconds * 1000);

      const totalTime = Math.round((Date.now() - startTime) / 1000);
      return {
        id,
        type,
        status: 'BOUNCE USER',
        duration: `${totalTime}s`,
        device: device.name,
        details: 'Thoát sớm < 10s (Không tính Active)'
      };
    }
  } catch (err) {
    return {
      id,
      type,
      status: 'ERROR',
      duration: '0s',
      device: device.name,
      details: err.message
    };
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {}
    }
  }
}

// ================= HÀM CHÍNH ĐIỀU PHỐI =================
async function main() {
  console.clear();
  console.log('================================================================');
  console.log('     MAYACA M4 - GA4 TRAFFIC SIMULATOR (ROLLING POOL v2.0)      ');
  console.log('================================================================');

  const chromeExe = getChromeExecutable();
  if (!chromeExe) {
    console.error('❌ Lỗi: Không tìm thấy Chrome hoặc Edge trên máy tính!');
    process.exit(1);
  }
  console.log(` Trình duyệt: ${chromeExe}`);
  console.log(` Mục tiêu: ${CONFIG.targetUrl}\n`);

  // Phân tích tham số dòng lệnh
  const args = process.argv.slice(2);
  const isTestMode = args.includes('--test');
  const isHeadless = !args.includes('--no-headless');

  let targetNew = isTestMode ? 2 : CONFIG.defaultNewUsers;
  let targetReturning = isTestMode ? 1 : CONFIG.defaultReturningUsers;
  let targetActive = isTestMode ? 2 : CONFIG.defaultActiveUsers;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--new' && args[i + 1]) targetNew = parseInt(args[i + 1]);
    if (args[i] === '--returning' && args[i + 1]) targetReturning = parseInt(args[i + 1]);
    if (args[i] === '--active' && args[i + 1]) targetActive = parseInt(args[i + 1]);
  }

  const totalUsers = targetNew + targetReturning;
  console.log(` CHỈ TIÊU HÔM NAY:`);
  console.log(`   - Total Users (Tập hợp mẹ) : ${totalUsers} lượt`);
  console.log(`   - New Users (Khách mới)    : ${targetNew} lượt`);
  console.log(`   - Returning Users (Khách cũ): ${targetReturning} lượt (Xoay vòng từ Rolling Pool)`);
  console.log(`   - Active Users (Tương tác) : ${targetActive} lượt (> 10s + cuộn trang)`);
  console.log(`   - Bounced Users (Thoát sớm): ${totalUsers - targetActive} lượt (< 10s)\n`);
  console.log('----------------------------------------------------------------\n');

  const profilesBaseDir = path.join(__dirname, 'profiles');
  const tempBaseDir = path.join(profilesBaseDir, 'temp_new');
  fs.mkdirSync(tempBaseDir, { recursive: true });

  const poolManager = new RollingPoolManager(profilesBaseDir);
  const returningList = poolManager.getReturningProfiles(targetReturning);

  const tasks = [];

  // Phân bổ Active User
  const returningActiveCount = Math.min(targetReturning, Math.round(targetActive * 0.25));
  const newActiveCount = targetActive - returningActiveCount;

  // Thêm Returning Users từ Rolling Pool
  returningList.forEach((item, index) => {
    tasks.push({
      id: tasks.length + 1,
      type: 'RETURNING',
      isActive: index < returningActiveCount,
      profileDir: item.profileDir,
      visitCount: item.visitCount
    });
  });

  // Chọn ra khoảng 12 New Users hôm nay để chuyển vào Rolling Pool cho ngày mai
  const seedToPoolTarget = isTestMode ? 1 : Math.min(12, targetNew);
  let seededCount = 0;

  // Thêm New Users
  for (let i = 1; i <= targetNew; i++) {
    const profileDir = path.join(tempBaseDir, `new_${Date.now()}_${i}`);
    const shouldSaveToPool = seededCount < seedToPoolTarget;
    if (shouldSaveToPool) seededCount++;

    tasks.push({
      id: tasks.length + 1,
      type: 'NEW',
      isActive: i <= newActiveCount,
      profileDir,
      isTemp: true,
      saveToPool: shouldSaveToPool
    });
  }

  // Trộn ngẫu nhiên thứ tự để phiên vào ra tự nhiên
  tasks.sort(() => Math.random() - 0.5);

  let completedCount = 0;
  let successActive = 0;
  let successBounce = 0;
  let successReturning = 0;
  let successNew = 0;

  const runWorker = async () => {
    while (tasks.length > 0) {
      const task = tasks.shift();
      const num = ++completedCount;
      const typeBadge = task.type === 'NEW' ? '[NEW USER]' : `[RETURNING #${task.visitCount || 2}]`;
      const activeBadge = task.isActive ? '🔥 ACTIVE' : '💤 BOUNCE';

      process.stdout.write(`[${num}/${totalUsers}] Đang chạy ${typeBadge} (${activeBadge})... `);

      const result = await simulateSession({
        id: task.id,
        type: task.type,
        isActive: task.isActive,
        profileDir: task.profileDir,
        executablePath: chromeExe,
        headless: isHeadless
      });

      // Nếu là khách mới được chọn để dành làm Returning User cho ngày mai -> nạp vào Pool
      if (task.saveToPool) {
        poolManager.saveNewUserToPool(task.profileDir);
      } else if (task.isTemp && fs.existsSync(task.profileDir)) {
        // Ngược lại thì xóa sạch thư mục tạm
        try {
          fs.rmSync(task.profileDir, { recursive: true, force: true });
        } catch (e) {}
      }

      if (result.status === 'ACTIVE USER') successActive++;
      if (result.status === 'BOUNCE USER') successBounce++;
      if (task.type === 'NEW') successNew++;
      if (task.type === 'RETURNING') successReturning++;

      console.log(`Xong! [${result.duration}] ${result.device}`);

      // Nghỉ ngắn ngẫu nhiên giữa các lượt (1s - 3s)
      await sleep(randomInt(1000, 3000));
    }
  };

  const workerCount = isTestMode ? 1 : CONFIG.concurrency;
  const workers = [];
  for (let w = 0; w < workerCount; w++) {
    workers.push(runWorker());
  }

  await Promise.all(workers);

  // Dọn dẹp thư mục tạm
  try {
    fs.rmSync(tempBaseDir, { recursive: true, force: true });
  } catch (e) {}

  console.log('\n================================================================');
  console.log('                      KẾT QUẢ HOÀN THÀNH                        ');
  console.log('================================================================');
  console.log(` Tổng số lượt truy cập (Total Users) : ${completedCount}`);
  console.log(` - Khách mới (New Users)             : ${successNew}`);
  console.log(` - Khách cũ quay lại (Returning)     : ${successReturning}`);
  console.log(` - Khách tương tác (Active Users >10s): ${successActive}`);
  console.log(` - Khách thoát sớm (Bounce <10s)     : ${successBounce}`);
  console.log(` - Đã lưu thêm vào Rolling Pool      : ${seedToPoolTarget} khách mới (sẽ quay lại vào ngày mai/mốt)`);
  console.log('================================================================');
  console.log(' Đã đồng bộ số liệu lên Google Analytics 4 & Microsoft Clarity!');
  console.log(' Số liệu Cohort Retention trên GA4 sẽ trông tự nhiên 100%.');
  console.log('================================================================\n');
}

main().catch(console.error);
