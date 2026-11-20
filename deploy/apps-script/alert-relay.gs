/**
 * MediDispense alert email relay (Google Apps Script web app).
 *
 * The Railway alert worker POSTs alerts here over HTTPS (outbound SMTP is blocked on
 * Railway's Hobby/Trial plans); this script sends them from the Gmail account that owns it.
 *
 * Setup: Project Settings -> Script Properties -> add RELAY_SECRET (same value as the
 * ALERT_MAIL_RELAY_SECRET Railway variable). Deploy -> New deployment -> Web app,
 * Execute as: Me, Who has access: Anyone. Copy the /exec URL to ALERT_MAIL_RELAY_URL.
 */
function doPost(e) {
  try {
    var expected = PropertiesService.getScriptProperties().getProperty('RELAY_SECRET') || '';
    var data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (expected.length < 24 || !sameSecret_(String(data.secret || ''), expected)) return reply_(false, 'unauthorized');
    var to = String(data.to || '');
    if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(to)) return reply_(false, 'invalid recipient');
    var subject = String(data.subject || '').slice(0, 250);
    if (!subject) return reply_(false, 'missing subject');
    MailApp.sendEmail({ to: to, subject: subject, body: String(data.text || ''), htmlBody: String(data.html || ''), name: 'MediDispense' });
    return reply_(true, '');
  } catch (err) {
    return reply_(false, String(err && err.message || err).slice(0, 200));
  }
}

/** Constant-time comparison so the secret cannot be guessed by timing. */
function sameSecret_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function reply_(ok, error) {
  return ContentService.createTextOutput(JSON.stringify(ok ? { ok: true } : { ok: false, error: error }))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Run once from the editor (select it, press Run) to grant Gmail permission and test. */
function testSend() {
  MailApp.sendEmail(Session.getActiveUser().getEmail(), 'MediDispense relay test', 'The alert relay can send email.');
}
