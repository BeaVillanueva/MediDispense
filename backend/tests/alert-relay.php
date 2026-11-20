<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') exit;
require __DIR__.'/../vendor/autoload.php';
require_once __DIR__.'/../src/AlertEmail.php';

$url='https://script.google.com/macros/s/AKfycbTESTONLY_relay-id_1234567890/exec';
$secret='test-only-relay-secret-0123456789';
$checks=0;
$ok=static function(bool $c,string $m) use(&$checks){ if(!$c) throw new RuntimeException($m); $checks++; };

// Configuration validation.
$ok((new AppsScriptAlertTransport($url,$secret))->configured(),'valid relay must be configured');
$ok(!(new AppsScriptAlertTransport('http://script.google.com/macros/s/AKfycbTESTONLY_relay-id_1234567890/exec',$secret))->configured(),'plain http must be rejected');
$ok(!(new AppsScriptAlertTransport('https://evil.example.com/macros/s/AKfycbTESTONLY_relay-id_1234567890/exec',$secret))->configured(),'non-Google host must be rejected');
$ok(!(new AppsScriptAlertTransport($url,'short'))->configured(),'short secret must be rejected');
$ok(!(new AppsScriptAlertTransport('',''))->configured(),'empty relay must be disabled');

// Capture error_log output to make sure the secret never leaks.
$log=tempnam(sys_get_temp_dir(),'md-relay-'); ini_set('error_log',$log);
$send=static function(array $response) use($url,$secret,&$sent){
    $t=new AppsScriptAlertTransport($url,$secret,function(string $u,string $json) use($response,&$sent){ $sent=[$u,json_decode($json,true)]; return $response; });
    try { $t->send('admin@example.com','Low Stock Alert','<p>3 units</p>','3 units','<id@x>'); return null; }
    catch(AlertMailFailure $e){ return $e; }
};
try {
    $sent=null;
    $ok($send(['status'=>200,'body'=>'{"ok":true}','error'=>'','sent'=>true])===null,'ok reply must succeed');
    $ok($sent[0]===$url && $sent[1]['to']==='admin@example.com' && $sent[1]['subject']==='Low Stock Alert' && $sent[1]['html']==='<p>3 units</p>' && $sent[1]['text']==='3 units' && $sent[1]['secret']===$secret,'payload must carry the alert');
    $e=$send(['status'=>500,'body'=>'error','error'=>'','sent'=>true]); $ok($e instanceof AlertMailFailure && !$e->uncertain,'HTTP 500 must be retryable');
    $e=$send(['status'=>200,'body'=>'{"ok":false,"error":"unauthorized"}','error'=>'','sent'=>true]); $ok($e instanceof AlertMailFailure && !$e->uncertain,'ok:false must be retryable');
    $e=$send(['status'=>0,'body'=>'','error'=>'Could not connect','sent'=>false]); $ok($e instanceof AlertMailFailure && !$e->uncertain,'connect failure must be retryable');
    $e=$send(['status'=>0,'body'=>'','error'=>'Operation timed out','sent'=>true]); $ok($e instanceof AlertMailFailure && $e->uncertain,'timeout after sending must be uncertain');
    $e=$send(['status'=>200,'body'=>'<html>not json '.$secret.'</html>','error'=>'','sent'=>true]); $ok($e instanceof AlertMailFailure && $e->uncertain,'unreadable reply must be uncertain');
    $ok(!str_contains((string)file_get_contents($log),$secret),'secret must never be logged');
} finally { ini_restore('error_log'); @unlink($log); }
echo "$checks alert relay checks passed. No network or email used.\n";
