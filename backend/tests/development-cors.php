<?php
require __DIR__.'/../src/Http/DevelopmentCors.php';
$server=['HTTP_HOST'=>'192.168.1.65','SERVER_ADDR'=>'192.168.1.65'];
$cases=[['http://192.168.1.65:3000','development',true],['http://192.168.1.65:3001','development',true],['http://192.168.1.66:3000','development',false],['http://192.168.1.65:9000','development',false],['http://evil.example:3000','development',false],['http://192.168.1.65:3000','production',false],['http://192.168.1.65:3000/path','development',false]];
foreach($cases as [$origin,$env,$expected]) if(allowsDevelopmentOrigin($origin,['app_env'=>$env],$server)!==$expected) throw new RuntimeException('CORS case failed');
echo "Passed 7 CORS checks.\n";
$server=['HTTP_HOST'=>'192.168.1.81','SERVER_ADDR'=>'192.168.1.81'];
foreach([3000,3001,3002,3019,5173] as $port)if(!allowsDevelopmentOrigin('http://192.168.1.81:'.$port,['app_env'=>'development'],$server))throw new RuntimeException('LAN frontend port denied');
foreach(['http://192.168.1.81:3020','http://192.168.1.82:3000','https://192.168.1.81:3000'] as $origin)if(allowsDevelopmentOrigin($origin,['app_env'=>'development'],$server))throw new RuntimeException('Unexpected origin allowed');
echo "Passed 8 LAN/port boundary checks; production still requires an explicit allowlist.\n";
