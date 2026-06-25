document.addEventListener('DOMContentLoaded', function() {
  const generateBtn = document.getElementById('generateBtn');
  const emailInput = document.getElementById('emailInput');
  const copyBtn = document.getElementById('copyBtn');
  const passwordInput = document.getElementById('passwordInput');
  const copyPassBtn = document.getElementById('copyPassBtn');
  const autoFillBtn = document.getElementById('autoFillBtn');
  const continueWebBtn = document.getElementById('continueWebBtn');
  const inboxSection = document.getElementById('inboxSection');
  const checkInboxBtn = document.getElementById('checkInboxBtn');
  const messagesList = document.getElementById('messagesList');

  let currentToken = "";
  let currentEmail = "";

  chrome.storage.local.get(['savedEmail', 'savedToken'], function(result) {
    if (result.savedEmail && result.savedToken) {
      currentEmail = result.savedEmail;
      currentToken = result.savedToken;
      emailInput.value = currentEmail;
      inboxSection.style.display = 'block';
      generateBtn.textContent = "GENERATE NEW";
    }
  });

  function generateRandomString(length) {
    return Math.random().toString(36).substring(2, 2 + length);
  }

  function copyToClipboard(inputEl, btnEl) {
    navigator.clipboard.writeText(inputEl.value);
    const originalText = btnEl.textContent;
    btnEl.textContent = "COPIED!";
    setTimeout(() => btnEl.textContent = originalText, 1500);
  }

  copyBtn.addEventListener('click', () => copyToClipboard(emailInput, copyBtn));
  copyPassBtn.addEventListener('click', () => copyToClipboard(passwordInput, copyPassBtn));

  // AUTO-FILL
  autoFillBtn.addEventListener('click', async function() {
    if (!currentEmail) return alert("GENERATE EMAIL FIRST.");
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async (email, password) => {
        const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        const emailField = document.querySelector('input[type="email"], input[name*="email" i], input[id*="email" i]');
        const passFields = document.querySelectorAll('input[type="password"]');
        
        if (emailField) {
          await sleep(200);
          emailField.value = email;
          emailField.dispatchEvent(new Event('input', { bubbles: true }));
          emailField.dispatchEvent(new Event('change', { bubbles: true }));
        }
        
        if (passFields.length > 0) {
          for (let field of passFields) {
            await sleep(300);
            field.value = password;
            field.dispatchEvent(new Event('input', { bubbles: true }));
            field.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
      },
      args: [currentEmail, passwordInput.value]
    });
  });

  // CONTINUE ON WEB BUTTON LOGIC
  continueWebBtn.addEventListener('click', async function() {
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const buttons = document.querySelectorAll('button, input[type="submit"]');
        let targetButton = null;

        for (let btn of buttons) {
          const text = (btn.innerText || btn.value || "").toLowerCase();
          if (text.includes('continue') || text.includes('log in') || text.includes('sign in') || text.includes('submit')) {
            targetButton = btn;
            break;
          }
        }

        if (!targetButton) {
          targetButton = document.querySelector('button[type="submit"]');
        }

        if (targetButton) {
          targetButton.click();
        } else {
          alert("Could not find a 'Continue' or 'Submit' button on this page.");
        }
      }
    });
  });

  // GENERATE EMAIL
  generateBtn.addEventListener('click', async function() {
    generateBtn.textContent = "WAIT...";
    try {
      const domainRes = await fetch('https://api.mail.tm/domains');
      const domainRaw = await domainRes.text();
      if (domainRaw.trim().startsWith('<')) throw new Error("API Blocked.");
      
      const domainData = JSON.parse(domainRaw);
      const domain = domainData['hydra:member'][0].domain;
      const newEmail = `${generateRandomString(10)}@${domain}`;
      const pass = generateRandomString(12);

      await fetch('https://api.mail.tm/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: newEmail, password: pass })
      });

      const tokenRes = await fetch('https://api.mail.tm/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: newEmail, password: pass })
      });
      const tokenData = await tokenRes.json();
      
      currentEmail = newEmail;
      currentToken = tokenData.token;

      chrome.storage.local.set({ savedEmail: currentEmail, savedToken: currentToken });
      emailInput.value = currentEmail;
      generateBtn.textContent = "GENERATE NEW";
      inboxSection.style.display = 'block';
      messagesList.innerHTML = "Listening for packets...";
    } catch (error) {
      emailInput.value = "ERROR.";
      generateBtn.textContent = "RETRY";
    }
  });

  // CHECK INBOX
  checkInboxBtn.addEventListener('click', async function() {
    if (!currentToken) return;
    checkInboxBtn.textContent = "...";
    try {
      const response = await fetch('https://api.mail.tm/messages', {
        headers: { 'Authorization': `Bearer ${currentToken}` }
      });
      const data = await response.json();
      const messages = data['hydra:member'];
      
      if (!messages || messages.length === 0) {
        messagesList.innerHTML = "NO NEW PACKETS.";
      } else {
        messagesList.innerHTML = ""; 
        for (const msg of messages) {
          const msgResponse = await fetch(`https://api.mail.tm/messages/${msg.id}`, {
             headers: { 'Authorization': `Bearer ${currentToken}` }
          });
          const msgData = await msgResponse.json();
          let bodyContent = msgData.text ? msgData.text : (msgData.html ? msgData.html[0].replace(/<[^>]*>?/gm, ' ').trim() : "No content.");
          
          const otpMatch = bodyContent.match(/\b\d{4,8}\b/);
          let otpButtonHTML = "";
          if (otpMatch) {
             otpButtonHTML = `<button class="inject-otp-btn" data-otp="${otpMatch[0]}">INJECT CODE: ${otpMatch[0]}</button>`;
          }

          const msgDiv = document.createElement('div');
          msgDiv.className = 'message-item';
          msgDiv.innerHTML = `
            <div class="message-subject">${msgData.subject}</div>
            <div style="font-size: 10px; color: #005500;">FROM: ${msgData.from.address}</div>
            <div class="message-body">${bodyContent.substring(0, 80)}...</div>
            ${otpButtonHTML}
          `;
          messagesList.appendChild(msgDiv);
        }

        document.querySelectorAll('.inject-otp-btn').forEach(btn => {
          btn.addEventListener('click', async function() {
            const otpCode = this.getAttribute('data-otp');
            let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: (code) => {
                const otpFields = document.querySelectorAll('input[type="text"], input[type="number"]');
                if(otpFields.length > 0) {
                  for(let field of otpFields) {
                    if(field.value === "") {
                      field.value = code;
                      field.dispatchEvent(new Event('input', { bubbles: true }));
                      break;
                    }
                  }
                }
              },
              args: [otpCode]
            });
            this.textContent = "INJECTED!";
            this.style.backgroundColor = "#39ff14";
            this.style.color = "#000";
          });
        });
      }
      checkInboxBtn.textContent = "REFRESH";
    } catch (error) {
      messagesList.innerHTML = "NETWORK FAILURE.";
      checkInboxBtn.textContent = "REFRESH";
    }
  });
});