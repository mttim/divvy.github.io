const SHEET_ID = '1LDvD0z-TpO_AwOqNtRo5y4phDHwQtJzrcUPWmgypIq8'; 
const FOLDER_ID = '177UiU67dDoHYyx1wm2t0rc1LNUiSVfxU'; // ★★★ ใส่ ID Folder รูปของคุณตรงนี้ ★★★

function doGet() {
  // เพิ่มบรรทัดนี้เพื่อให้เว็บไซต์ภายนอกเข้าถึงได้
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setTitle('Divvy')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getSheet(name) {
  let ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if(name === 'Trips') sheet.appendRow(['ID', 'Name', 'Members', 'Date', 'Owner', 'SharedEmails']);
    if(name === 'GlobalMembers') sheet.appendRow(['ID', 'Name', 'Date', 'QR', 'Owner', 'FriendEmail']);
    if(name === 'Expenses') sheet.appendRow(['ID', 'TripID', 'Desc', 'Amount', 'Payer', 'Splitters', 'Slip', 'PaidMembers', 'SlipJSON']);
    if(name === 'UserProfiles') sheet.appendRow(['Email', 'Name', 'QR_URL', 'LastUpdated']);
  }
  return sheet;
}

function getDataWithSmartShift(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  data.shift();
  return data;
}

// ★ ฟังก์ชันใหม่: จัดการ Profile และ Sync ลง GlobalMembers
// ★ แก้ไขฟังก์ชันนี้เพื่อให้บันทึกลงคอลัมน์ที่ถูกต้อง
// 1. ปรับปรุงการบันทึกให้ตรงกับ 4 คอลัมน์ใหม่
function updateFullProfile(name, email, qrUrl) {
  // 1. จัดการ UserProfiles (ที่เก็บข้อมูลถาวรของเรา)
  const upSheet = getSheet('UserProfiles');
  const upData = upSheet.getDataRange().getValues();
  let upRow = -1;
  for(let i=1; i<upData.length; i++) { if(upData[i][0] == email) { upRow = i+1; break; } }
  
  if(upRow > -1) {
    if(name) upSheet.getRange(upRow, 2).setValue(name);
    if(qrUrl) upSheet.getRange(upRow, 3).setValue(qrUrl);
    upSheet.getRange(upRow, 4).setValue(new Date());
  } else {
    upSheet.appendRow([email, name || "Guest", qrUrl || "", new Date()]);
  }

  // 2. จัดการ GlobalMembers (ตัวเราในฐานะ "สมาชิก" ที่เราเป็นเจ้าของเอง)
  const gmSheet = getSheet('GlobalMembers');
  const gmData = gmSheet.getDataRange().getValues();
  let gmRow = -1;
  // เช็คว่ามีแถวที่ Owner เป็นเรา และ FriendEmail เป็นเรา หรือยัง?
  for(let j=1; j<gmData.length; j++) {
    if(gmData[j][4] == email && gmData[j][5] == email) { gmRow = j+1; break; }
  }

  if(gmRow > -1) {
    if(name) gmSheet.getRange(gmRow, 2).setValue(name);
    if(qrUrl) gmSheet.getRange(gmRow, 4).setValue(qrUrl);
  } else {
    // ถ้ายังไม่มี ให้สร้างแถว "ตัวเอง" ขึ้นมาใหม่โดยเราเป็น Owner
    gmSheet.appendRow([Utilities.getUuid(), name || "Me", new Date(), qrUrl || "", email, email]);
  }
  
  return {status: 'success'};
}

// 3. แก้ไขการดึง QR ให้ถูกคอลัมน์ (คอลัมน์ C คือ index 2)
function getMyQr(e) {
  const d = getDataWithSmartShift(getSheet('UserProfiles'));
  const u = d.find(r => r[0] == e);
  return u ? u[2] : null; 
}

// แก้ฟังก์ชัน saveMyQr ให้เรียกใช้ตัวกลาง
function saveMyQr(fileData, email) {
  try {
    const folder = DriveApp.getFolderById(FOLDER_ID.trim());
    const file = folder.createFile(Utilities.newBlob(Utilities.base64Decode(fileData.data), fileData.mimeType, fileData.name));
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const url = "https://drive.google.com/thumbnail?id=" + file.getId() + "&sz=w1000";
    
    updateFullProfile(null, email, url); // อัปเดตเฉพาะ QR
    return {status: 'success', url: url};
  } catch(e) { return {status: 'error', message: e.toString()}; }
}

// ฟังก์ชันอื่นๆ คงเดิม...



// ฟังก์ชันเสริมสำหรับดึงชื่อจากโปรไฟล์จริง
function getProfileName(email) {
  const d = getDataWithSmartShift(getSheet('UserProfiles'));
  const u = d.find(r => r[0] == email);
  return u ? u[1] : null;
}
// 1. เพิ่มเพื่อนปุ๊บ บันทึก 2 บรรทัดทันทีเพื่อให้เพื่อนเห็นเราด้วย
// 1. ดึงเพื่อน: เห็นเฉพาะที่เราเป็นเจ้าของ (Owner) เท่านั้น
// แก้ไขให้ดึงเฉพาะเพื่อนที่ Owner ตรงกับคนล็อกอินเท่านั้น
function getGlobalMembers(userEmail) {
  const sheet = getSheet('GlobalMembers');
  const data = getDataWithSmartShift(sheet);
  if (!data.length) return [];
  
  // กรองเฉพาะแถวที่คอลัมน์ E (Owner) ตรงกับ userEmail ที่ล็อกอิน
  return data.filter(r => r[4] === userEmail).map(r => ({ 
    id: r[0], 
    name: r[1], 
    qr: r[3], 
    email: r[5] 
  })).reverse();
}
// 2. แอดเพื่อน: บันทึก 2 บรรทัดทันที (Mutual Friend)
function addGlobalMember(friendName, friendEmail, myEmail) {
  const sheet = getSheet('GlobalMembers');
  const myRealName = getProfileName(myEmail) || "Friend";
  
  // บรรทัดที่ 1: เราแอดเขา
  sheet.appendRow([Utilities.getUuid(), friendName, new Date(), "", myEmail, friendEmail]);
  // บรรทัดที่ 2: เขาแอดเรา (เพื่อให้เขาเห็นเราทันที)
  if (friendEmail) {
    sheet.appendRow([Utilities.getUuid(), myRealName, new Date(), getMyQr(myEmail) || "", friendEmail, myEmail]);
  }
  return {status: 'success'};
}

// 3. ดึงทริป: เห็นเฉพาะทริปที่เราเป็นเจ้าของ หรือ มีอีเมลเราอยู่ใน SharedEmails
function getTrips(userEmail) {
  try {
    const sheet = getSheet('Trips');
    const data = getDataWithSmartShift(sheet);
    return data.filter(r => {
      const owner = (r[4]||"").toString();
      const shared = (r[5]||"").toString();
      return owner === userEmail || shared.toLowerCase().includes(userEmail.toLowerCase());
    }).map(r => ({ 
      id: r[0], 
      name: r[1], 
      members: r[2], 
      owner: r[4], 
      emails: r[5] // ต้องส่ง Emails (คอลัมน์ F) กลับไปให้หน้าบ้านด้วยเสมอ
    })).reverse();
  } catch (e) { return []; }
}
function createTrip(name, members, userEmail) { const sheet = getSheet('Trips'); const newId = Utilities.getUuid(); const memberNames = members.split(',').map(s=>s.trim()); const gmData = getDataWithSmartShift(getSheet('GlobalMembers')).filter(r=>r[4]==userEmail); const emails = memberNames.map(n => { if(n==='Me' || n===userEmail) return userEmail; const f = gmData.find(fr=>fr[1]===n); return f ? f[5] : ""; }).join(','); sheet.appendRow([newId, name, members, new Date(), userEmail, emails]); return {status: 'success', realId: newId}; }
function deleteTrip(id) { const s=getSheet('Trips'); const d=s.getDataRange().getValues(); for(let i=0;i<d.length;i++){if(d[i][0]==id){s.deleteRow(i+1);break;}} return {status:'success'};}
function getExpenses(tripId) {
  const sheet = getSheet('Expenses');
  const data = sheet.getDataRange().getValues();
  
  // กรองบิลที่ตรงกับทริปนี้
  const filtered = data.filter(row => row[1] == tripId);
  
  return filtered.map(row => {
    // แกะข้อมูล JSON สลิปของสมาชิก (คอลัมน์ J / Index 9)
    let slips = {};
    try {
      slips = row[9] ? JSON.parse(row[9]) : {};
    } catch (e) { slips = {}; }

    return {
      id: row[0],
      tripId: row[1],
      desc: row[2],
      amount: row[3],
      payer: row[4],
      splitters: row[5],
      slipUrl: row[6],
      paidMembers: row[8] || "", // รายชื่อคนจ่าย (คอลัมน์ I)
      memberSlips: slips         // วัตถุเก็บลิงก์สลิปของทุกคน
    };
  }).reverse();
}
function addExpense(obj, fileData) { const sheet = getSheet('Expenses'); const realId = Utilities.getUuid(); let url = ""; if(fileData) { const folder = DriveApp.getFolderById(FOLDER_ID.trim()); const file = folder.createFile(Utilities.newBlob(Utilities.base64Decode(fileData.data), fileData.mimeType, fileData.name)); file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); url = "https://drive.google.com/thumbnail?id=" + file.getId() + "&sz=w1000"; } sheet.appendRow([realId, obj.tripId, obj.desc, obj.amount, obj.payer, obj.splitters.join(','), url, "", "{}"]); return {status: 'success', realId: realId}; }
// ฟังก์ชันลบบิล
function deleteExpense(id) {
  const sheet = getSheet('Expenses');
  const data = sheet.getDataRange().getValues();
  // ลบโดยการค้นหา ID (สมมติ ID อยู่คอลัมน์ A)
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] == id) {
      sheet.deleteRow(i + 1);
      return { status: 'success' };
    }
  }
  return { status: 'error', message: 'Not found' };
}

// ฟังก์ชันอัปเดตสถานะการจ่ายเงิน
// ฟังก์ชันอัปเดตสถานะการจ่าย + อัปโหลดสลิป (ถ้ามี)
function updateMemberPayment(expId, memberName, fileObj) {
  const sheet = getSheet('Expenses');
  const data = sheet.getDataRange().getValues();
  
  // ค้นหาแถวที่ตรงกับ ID (สมมติ ID อยู่คอลัมน์ A / Index 0)
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] == expId) {
      
      // 1. อัปเดตรายชื่อคนจ่าย (Column I / Index 8)
      let currentPaid = data[i][8] ? data[i][8].toString() : "";
      let paidList = currentPaid ? currentPaid.split(',') : [];
      
      if (!paidList.includes(memberName)) {
        paidList.push(memberName);
        sheet.getRange(i + 1, 9).setValue(paidList.join(',')); // Col I
      }

      // 2. ถ้ามีไฟล์แนบมา -> อัปโหลดลง Drive -> บันทึกลิงก์ (Column J / Index 9)
      if (fileObj) {
        try {
          // แปลง Base64 กลับเป็นไฟล์
          const blob = Utilities.newBlob(Utilities.base64Decode(fileObj.data), fileObj.mimeType, "Slip_" + memberName + "_" + fileObj.name);
          
          // หาโฟลเดอร์ชื่อ 'Divvy_Slips' ถ้าไม่มีให้สร้างใหม่
          const folders = DriveApp.getFoldersByName("Divvy_Slips");
          let folder;
          if (folders.hasNext()) {
            folder = folders.next();
          } else {
            folder = DriveApp.createFolder("Divvy_Slips");
          }
          
          // สร้างไฟล์ในโฟลเดอร์
          const file = folder.createFile(blob);
          const fileUrl = file.getDownloadUrl(); // หรือ file.getUrl() สำหรับ view link
          
          // อ่าน JSON เดิมจาก Column J (ถ้ามี)
          let slipJson = {};
          const currentJsonStr = data[i][9] ? data[i][9].toString() : "";
          if (currentJsonStr) {
            try { slipJson = JSON.parse(currentJsonStr); } catch(e) {}
          }
          
          // บันทึก URL สลิปของคนนี้ลงไป
          slipJson[memberName] = "https://lh3.googleusercontent.com/d/" + file.getId(); // ใช้ลิงก์ตรงเพื่อความชัวร์ในการแสดงผล
          
          // บันทึกกลับลงชีท Col J
          sheet.getRange(i + 1, 10).setValue(JSON.stringify(slipJson));
          
        } catch (e) {
          return { status: 'error', message: 'Upload Failed: ' + e.toString() };
        }
      }
      
      return { status: 'success' };
    }
  }
  return { status: 'error', message: 'Expense ID not found' };
}

function findFriendEmails(memberNamesStr, ownerEmail) {
  const memberNames = memberNamesStr.split(',').map(s => s.trim());
  const friendSheet = getSheet('GlobalMembers');
  const friendData = getDataWithSmartShift(friendSheet);
  
  // กรองเฉพาะเพื่อนที่เรา (Owner) เป็นคนเพิ่มเท่านั้น
  const myFriends = friendData.filter(r => r[4] == ownerEmail);
  
  let emails = memberNames.map((name, index) => {
    // 1. ถ้าเป็นสมาชิกคนแรก (Index 0) และชื่อคือชื่อเรา หรือ 'Me' ให้ใช้ ownerEmail
    if (index === 0 && (name === 'Me' || name === getProfileName(ownerEmail))) {
      return ownerEmail;
    }
    
    // 2. ถ้าไม่ใช่คนแรก หรือชื่อไม่ตรงกับเรา ให้ไปหาเมลเพื่อนจากชื่อ
    const f = myFriends.find(fr => fr[1] === name);
    
    // 3. ถ้าหาเมลเพื่อนไม่เจอ (กรณีเพิ่มเราเองเป็นเพื่อนซ้ำ) ให้เช็คว่าชื่อตรงกับเรามั้ย
    if (!f && name === getProfileName(ownerEmail)) return ownerEmail;
    
    return f ? (f[5] || "") : "";
  });
  
  return emails.join(',');
}


function saveExpense(obj) {
  const sheet = getSheet('Expenses');
  const data = sheet.getDataRange().getValues();
  let slipUrl = "";

  // 1. จัดการอัปโหลดไฟล์สลิป (ถ้ามีส่งมา)
  if (obj.file) {
    try {
      const folder = DriveApp.getFolderById(FOLDER_ID);
      const blob = Utilities.newBlob(Utilities.base64Decode(obj.file.data), obj.file.mimeType, "bill_" + obj.desc + "_" + obj.file.name);
      const file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      slipUrl = file.getUrl();
    } catch(e) {
      Logger.log("Upload failed: " + e.toString());
    }
  }

  // 2. กรณีแก้ไขบิลเดิม (Edit)
  if (obj.id) {
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] == obj.id) {
        const row = i + 1;
        sheet.getRange(row, 3).setValue(obj.desc);   // คอลัมน์ C: Desc
        sheet.getRange(row, 4).setValue(obj.amt);    // คอลัมน์ D: Amt
        sheet.getRange(row, 5).setValue(obj.payer);  // คอลัมน์ E: Payer
        sheet.getRange(row, 6).setValue(obj.splitters); // คอลัมน์ F: Splitters
        if (slipUrl) sheet.getRange(row, 7).setValue(slipUrl); // คอลัมน์ G: Slip URL (ถ้ามีไฟล์ใหม่)
        return "Updated";
      }
    }
  }

  // 3. กรณีสร้างบิลใหม่ (New)
  const newRow = [
    Utilities.getUuid(), // A: ID
    obj.tripId,          // B: Trip ID
    obj.desc,            // C: Description
    obj.amt,             // D: Amount
    obj.payer,           // E: Payer
    obj.splitters,       // F: Splitters
    slipUrl,             // G: Slip URL
    new Date(),          // H: Timestamp
    "",                  // I: Paid Members
    "{}"                 // J: Member Slips JSON
  ];
  sheet.appendRow(newRow);
  return "Added";
}




function doPost(e) {
  const contents = JSON.parse(e.postData.contents);
  const action = contents.action;
  
  // สร้างระบบจัดการคำสั่งจาก GitHub
  if (action === 'getExpenses') return res(getExpenses(contents.tripId));
  if (action === 'saveExpense') return res(saveExpense(contents.data));
  // ... เพิ่ม action อื่นๆ ตามต้องการ
}

function res(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}