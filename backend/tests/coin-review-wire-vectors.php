<?php
// Pure protocol vectors only. No PDO, configuration, network, hardware or live keys.
require __DIR__.'/../src/CoinEventReview.php';
$decision=['id'=>str_repeat('b',32),'device_id'=>'112233445566','event_id'=>'coin-112233445566-00000001-ABCDEF1234567890-00000002','transaction_id'=>900182,'pulses'=>5,'amount'=>5,'nonce'=>str_repeat('c',32)];
$challenge=str_repeat('d',32);$key=hex2bin(str_repeat('a',64));
$text=CoinEventReview::decisionText($decision);$hash=hash('sha256',$text);
$ack=['id'=>$decision['id'],'device_id'=>$decision['device_id'],'archive_hash'=>$hash,'count'=>0];
echo json_encode(['decision'=>$decision,'challenge'=>$challenge,'decision_text'=>$text,'archive_hash'=>$hash,'decision_signature'=>hash_hmac('sha256',$text.'|'.$challenge,$key),'ack_text'=>CoinEventReview::ackText($ack),'ack_signature'=>hash_hmac('sha256',CoinEventReview::ackText($ack),$key)],JSON_THROW_ON_ERROR),"\n";
