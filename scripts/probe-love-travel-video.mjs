import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}});
page.on('pageerror',e=>console.log('PAGEERROR',String(e).slice(0,500)));
page.on('response',r=>{if(/api\/travel-commerce\/|api\/tours/.test(r.url()))console.log('API',r.status(),r.url().slice(0,130));});
async function dump(label){
  console.log('=== '+label+' '+page.url()+' ===');
  console.log('BODY',JSON.stringify((await page.locator('body').innerText()).slice(0,4200)));
  console.log('BUTTONS',JSON.stringify((await page.locator('button:visible').allTextContents()).slice(0,55)));
  console.log('NAV',JSON.stringify(await page.locator('[data-app-tab], [data-tab], [data-testid]').evaluateAll(els=>els.slice(0,45).map(e=>({tag:e.tagName,text:(e.textContent||'').trim().slice(0,45),tab:e.dataset.appTab,testid:e.dataset.testid})))));
  console.log('FORMS',await page.locator('textarea:visible, input:visible').count());
}
await page.goto('https://lovetravel.viiversion.com/',{waitUntil:'domcontentloaded',timeout:40000});
await page.evaluate(()=>localStorage.setItem('max-tour-locale-v1','en'));
await page.reload({waitUntil:'domcontentloaded'});
await page.waitForTimeout(2800);
await dump('ROOT');
let ai=page.locator('[data-app-tab="assistant"]:visible,button:has-text("AI"):visible,button:has-text("ИИ"):visible').first();
if(await ai.count()){await ai.click().catch(e=>console.log('AI_CLICK',String(e).slice(0,250)));await page.waitForTimeout(1200);await dump('AI_TAB');}
await page.goto('https://lovetravel.viiversion.com/v2/',{waitUntil:'domcontentloaded',timeout:40000});await page.waitForTimeout(2300);await dump('V2');
await browser.close();