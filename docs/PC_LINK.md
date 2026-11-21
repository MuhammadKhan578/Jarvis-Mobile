# Mobile Jarvis ↔ PC Jarvis — real direct link (Wi-Fi)

This is a **real LAN link** between the Jarvis app on your phone and PC Jarvis
on your computer. Files, save commands, commands and the voice intercom all go
over your Wi-Fi / hotspot to the PC. The PC's own response is what you hear;
nothing is simulated or faked.

**Ye phone call nahi hai.** Isme **koi phone number nahi** hai, SIM/number se
koi call nahi hoti, call recording nahi hoti. "Call PC Jarvis" sirf Wi-Fi voice
intercom hai (mic se PC tak text commands). **Real phone call** chahiye to PC
Jarvis ke liye alag se **Twilio line** (account + number) setup karna padega —
is mobile link mein wo nahi hai.

## Requirements / limits

- Phone aur PC **same Wi-Fi** ya phone hotspot par ho. Internet zaroori nahi.
- PC Jarvis ka device-link server chalna chahiye (default port **8766**).
- Pairing ke baad **token** phone ki private preferences mein save hota hai.
  Har upload/save/command us token ke saath bheja jata hai; token ke baghair PC
  request reject karta hai. Disconnect token hata deta hai.
- Plain HTTP sirf private LAN IP (`192.168.x.x`, `10.x.x.x`, `172.16–31.x.x`,
  `127.0.0.1`) ya `name.local` ke liye allowed hai. Public host par HTTP deny hai.
- Upload stream hota hai (large files bhi), lekin file PC tak tabhi pahunchti
  hai jab PC ka HTTP 2xx response aur JSON `ok: true` aaye. Save PC khud karta
  hai; PC ka confirmation gate hamesha intact rehta hai.
- Intercom explicit hai: tap-to-talk default, wake-word sirf background mein,
  aur "band karo" / "goodbye" / "disconnect" bolte hi mic band.
- Ye link desktop files ka browser nahi hai: Jo commands PC Jarvis support
  karta hai wahi `/link/command` par chalte hain. PC offline hai to honest error
  aata hai, koi fake "done" nahi.

## Setup

1. PC Jarvis par bolein: **"device link start"**.
2. PC Jarvis par bolein: **"device link code"** — wo one-time code batayega.
3. Phone par upar right wale **monitor icon (Connect to PC)** ko tap karein, ya
   bolein **"PC se connect karo"** / **"connect to PC"**.
4. Panel mein daalein:
   - **IP**: PC ka LAN IP (jaise `192.168.1.20`) ya `pc.local`
   - **Port**: `8766`
   - **Code**: PC ne jo code bataya
5. **Connect** dabaiye. Status line me real pair result dikhega. **Status**
   sirf local paired state aur last result batata hai; server status "unknown"
   tab tak hai jab tak aapne check na kiya ho.

## Any file upload + PC par save

1. Bolein: **"ye file PC par bhejo"** / **"send this file to PC"**.
2. Phone ka system file picker khulega — **koi bhi file** chuno: zip, photo,
   video, doc, PDF, etc.
3. App file ko stream karke PC par bhejta hai. PC ka sawaal/jawab (jaise
   "File mil gayi, kahan save karna hai?") **bola jata hai**.
4. Bolein: **"PC par Downloads mein save karo"**, ya exact path ke saath
   **"D:\backup\file.zip mein save karo"** ya **"save to Downloads"**.
   - Save uploaded file id aur aapka destination PC ko bhejta hai.
   - Agar PC confirmation maangta hai to uska **CONFIRMATION REQUIRED** message
     as-is bola jata hai; app khud confirmation nahi banata.

Agar aap pehle upload ke baad sirf destination bolein to last uploaded file id
use hoti hai. Nayi file ke liye dobara "ye file PC par bhejo" bolein.

## Wi-Fi voice intercom (PC Jarvis ko call)

1. Pehle upar ke steps se pair karein.
2. Bolein **"PC Jarvis ko call karo"** / **"call PC Jarvis"** / **"PC se baat karo"**,
   ya panel me **Call PC Jarvis** dabaiye.
3. Status line dikhegi: **"Calling PC Jarvis…"**. Har baat PC Jarvis ko
   `/link/command` par jati hai aur uska asli reply phone par bola jata hai.
4. Mic apne aap agle command ke liye wapas khulta hai (intercom ke dauran hi).
5. Band karne ke liye bolein **"band karo"**, **"goodbye"** ya **"disconnect"**,
   ya panel me **End PC Call** dabaiye.

Dobara: ye **phone call nahi hai**. Real call ke liye PC Twilio line chahiye;
is intercom mein number, dialing ya recording nahi hai.

## Troubleshooting

- "Host private LAN nahi" → PC ka public IP ya internet URL mat daalein; LAN IP
  ya `.local` daalein.
- "Pair nahi hua" → PC par device-link server chal raha hai ya nahi, code fresh
  hai ya nahi, aur port 8766 dekhein.
- "Upload reject" → PC ka token/permission ya disk space check karein; app
  success tabhi bolta hai jab PC `ok: true` bheje.
- "PC ka jawab nahi mila" → Wi-Fi same hai ya nahi aur PC online hai ya nahi.
