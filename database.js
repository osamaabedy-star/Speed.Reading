// database.js - نسخة محسنة مع دعم المستخدمين المتقدمين

let db;

// فتح قاعدة البيانات (أو إنشائها)
const request = indexedDB.open('StudentProgressDB', 2); // زدنا رقم الإصدار

request.onupgradeneeded = function(event) {
  db = event.target.result;
  const oldVersion = event.oldVersion;

  // إذا كانت النسخة القديمة 0 (قاعدة بيانات جديدة) أو أقل من 2، نقوم بإنشاء/تحديث الجداول
  if (oldVersion < 1) {
    // جدول المستخدمين
    const userStore = db.createObjectStore('users', { keyPath: 'username' });
    userStore.createIndex('grade', 'grade', { unique: false });
    userStore.createIndex('semester', 'semester', { unique: false });
    userStore.createIndex('approved', 'approved', { unique: false });

    // جدول جلسات القراءة
    const sessionStore = db.createObjectStore('reading_sessions', { 
      keyPath: 'id', 
      autoIncrement: true 
    });
    sessionStore.createIndex('username', 'username', { unique: false });
    sessionStore.createIndex('date', 'date', { unique: false });
    sessionStore.createIndex('lessonId', 'lessonId', { unique: false });

    // جدول نتائج الاختبارات
    const quizStore = db.createObjectStore('quiz_results', { 
      keyPath: 'id', 
      autoIncrement: true 
    });
    quizStore.createIndex('username', 'username', { unique: false });
    quizStore.createIndex('date', 'date', { unique: false });
    quizStore.createIndex('lessonId', 'lessonId', { unique: false });
  }

  // إذا كان التحديث من الإصدار 1 إلى 2، نضيف الحقول الجديدة للمستخدمين
  if (oldVersion < 2) {
    const transaction = event.target.transaction;
    const userStore = transaction.objectStore('users');
    
    // لا يمكن تعديل الحقول مباشرة، لذا سنقوم بترحيل البيانات يدوياً
    // لكننا سنستخدم طريقة أبسط: إعادة إنشاء المتجر (حذف وإضافة) مع الحفاظ على البيانات
    // هذا الحل معقد، لذا سنكتفي بإضافة الفهارس الجديدة وتحديث الكائنات عند التسجيل لاحقاً
    // لأن الحقول الجديدة ستكون موجودة عند إنشاء مستخدم جديد فقط، ولن نضيفها للمستخدمين القدامى
    // لتجنب التعقيد، سنقوم بإنشاء فهرس جديد للحقول (إذا لم تكن موجودة) لكن الحقول نفسها ستكون undefined للمستخدمين القدامى
    if (!userStore.indexNames.contains('phone')) {
      userStore.createIndex('phone', 'phone', { unique: false });
    }
    if (!userStore.indexNames.contains('fullName')) {
      userStore.createIndex('fullName', 'fullName', { unique: false });
    }
    if (!userStore.indexNames.contains('accountNumber')) {
      userStore.createIndex('accountNumber', 'accountNumber', { unique: true });
    }
    if (!userStore.indexNames.contains('approved')) {
      userStore.createIndex('approved', 'approved', { unique: false });
    }
  }
};

request.onsuccess = function(event) {
  db = event.target.result;
  console.log('✅ قاعدة البيانات جاهزة (الإصدار 2)');
};

request.onerror = function(event) {
  console.error('❌ خطأ في قاعدة البيانات:', event.target.error);
};

// ================== دوال التجزئة الآمنة ==================
// توليد salt عشوائي 16 بايت وتحويله إلى base64
function generateSalt() {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...salt));
}

// تجزئة كلمة المرور باستخدام SHA-256 مع salt
async function hashPassword(password, salt) {
  const encoder = new TextEncoder();
  const saltedPassword = salt + password; // نضيف salt قبل كلمة المرور
  const data = encoder.encode(saltedPassword);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// التحقق من كلمة المرور
async function verifyPassword(password, storedHash, storedSalt) {
  const hash = await hashPassword(password, storedSalt);
  return hash === storedHash;
}

// ================== دوال المستخدمين ==================

// تسجيل مستخدم جديد (مع البيانات الإضافية)
async function registerUser(username, password, fullName, phone, grade, semester) {
  return new Promise(async (resolve, reject) => {
    if (!db) return reject('قاعدة البيانات غير جاهزة');

    const transaction = db.transaction(['users'], 'readwrite');
    const store = transaction.objectStore('users');

    const checkRequest = store.get(username);
    checkRequest.onsuccess = async () => {
      if (checkRequest.result) {
        reject('اسم المستخدم موجود بالفعل');
        return;
      }

      // توليد salt وتجزئة كلمة المرور
      const salt = generateSalt();
      const hashedPassword = await hashPassword(password, salt);

      // توليد رقم حساب فريد
      const accountNumber = 'ACC' + Date.now() + '-' + Math.random().toString(36).substring(2, 8).toUpperCase();

      const newUser = {
        username,
        passwordHash: hashedPassword,
        salt: salt,
        fullName: fullName || '',
        phone: phone,
        accountNumber: accountNumber,
        grade: grade,
        semester: semester,
        approved: false, // يحتاج موافقة
        createdAt: new Date().toISOString()
      };

      const addRequest = store.add(newUser);
      addRequest.onsuccess = () => resolve(newUser);
      addRequest.onerror = (e) => reject('فشل في التسجيل: ' + e.target.error);
    };
    checkRequest.onerror = () => reject('خطأ في التحقق من اسم المستخدم');
  });
}

// تسجيل الدخول مع التحقق من الموافقة
async function loginUser(username, password) {
  return new Promise((resolve, reject) => {
    if (!db) return reject('قاعدة البيانات غير جاهزة');

    const transaction = db.transaction(['users'], 'readonly');
    const store = transaction.objectStore('users');
    const request = store.get(username);

    request.onsuccess = async () => {
      const user = request.result;
      if (!user) {
        reject('اسم المستخدم غير موجود');
        return;
      }

      // التحقق من الموافقة
      if (!user.approved) {
        reject('حسابك لم يتم تفعيله بعد، يرجى الانتظار أو مراجعة الإدارة');
        return;
      }

      // التحقق من كلمة المرور
      const isValid = await verifyPassword(password, user.passwordHash, user.salt);
      if (isValid) {
        // حفظ المستخدم في sessionStorage (بدون البيانات الحساسة)
        sessionStorage.setItem('currentUser', JSON.stringify({
          username: user.username,
          fullName: user.fullName,
          phone: user.phone,
          accountNumber: user.accountNumber,
          grade: user.grade,
          semester: user.semester,
          approved: user.approved
        }));
        resolve(user);
      } else {
        reject('كلمة المرور غير صحيحة');
      }
    };

    request.onerror = () => reject('خطأ في تسجيل الدخول');
  });
}

// تسجيل الخروج
function logoutUser() {
  sessionStorage.removeItem('currentUser');
  window.location.href = 'login.html';
}

// ================== دوال جلسات القراءة ==================

// حفظ جلسة قراءة
function saveReadingSession(sessionData) {
  const currentUser = JSON.parse(sessionStorage.getItem('currentUser'));
  if (!currentUser) return Promise.reject('لا يوجد مستخدم مسجل');

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['reading_sessions'], 'readwrite');
    const store = transaction.objectStore('reading_sessions');

    const session = {
      username: currentUser.username,
      lessonId: sessionData.lessonId,
      lessonTitle: sessionData.lessonTitle,
      date: new Date().toISOString(),
      speed: sessionData.speed,
      errors: sessionData.errors,
      duration: sessionData.duration,
      wordsRead: sessionData.wordsRead
    };

    const request = store.add(session);
    request.onsuccess = () => resolve(session);
    request.onerror = () => reject('فشل في حفظ الجلسة');
  });
}

// حفظ نتيجة الاختبار
function saveQuizResult(quizData) {
  const currentUser = JSON.parse(sessionStorage.getItem('currentUser'));
  if (!currentUser) return Promise.reject('لا يوجد مستخدم مسجل');

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['quiz_results'], 'readwrite');
    const store = transaction.objectStore('quiz_results');

    const result = {
      username: currentUser.username,
      lessonId: quizData.lessonId,
      lessonTitle: quizData.lessonTitle,
      date: new Date().toISOString(),
      score: quizData.score,
      correctAnswers: quizData.correct,
      totalQuestions: quizData.total
    };

    const request = store.add(result);
    request.onsuccess = () => resolve(result);
    request.onerror = () => reject('فشل في حفظ النتيجة');
  });
}

// ================== دوال الإدارة (لجلب المستخدمين وتحديثهم) ==================

// جلب جميع المستخدمين (لصفحة الإدارة)
function getAllUsers() {
  return new Promise((resolve, reject) => {
    if (!db) return reject('قاعدة البيانات غير جاهزة');
    const transaction = db.transaction(['users'], 'readonly');
    const store = transaction.objectStore('users');
    const request = store.getAll();
    request.onsuccess = () => {
      // نزيل البيانات الحساسة قبل الإرسال (لكننا نحتاجها للتعديل، لذا نرسلها كلها ولكن سنقوم بتصفيتها عند العرض)
      resolve(request.result);
    };
    request.onerror = () => reject('فشل في جلب المستخدمين');
  });
}

// تحديث حالة الموافقة لمستخدم
function updateUserApproval(username, approved) {
  return new Promise((resolve, reject) => {
    if (!db) return reject('قاعدة البيانات غير جاهزة');
    const transaction = db.transaction(['users'], 'readwrite');
    const store = transaction.objectStore('users');
    const getRequest = store.get(username);
    getRequest.onsuccess = () => {
      const user = getRequest.result;
      if (!user) {
        reject('المستخدم غير موجود');
        return;
      }
      user.approved = approved;
      const putRequest = store.put(user);
      putRequest.onsuccess = () => resolve(user);
      putRequest.onerror = () => reject('فشل في تحديث المستخدم');
    };
    getRequest.onerror = () => reject('فشل في جلب المستخدم');
  });
}

// حذف مستخدم
function deleteUser(username) {
  return new Promise((resolve, reject) => {
    if (!db) return reject('قاعدة البيانات غير جاهزة');
    const transaction = db.transaction(['users'], 'readwrite');
    const store = transaction.objectStore('users');
    const request = store.delete(username);
    request.onsuccess = () => resolve();
    request.onerror = () => reject('فشل في حذف المستخدم');
  });
}

// تغيير كلمة المرور (للمستخدم العادي أو الإدارة) - يمكن إضافته لاحقاً
// ...

console.log('✅ database.js محمل');