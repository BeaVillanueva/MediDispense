<?php
declare(strict_types=1);

/** Local files only. The directory must be provisioned privately; never auto-create it. */
final class ReferenceWorkerControl {
    private $lease=null;
    private array $instance=[];
    public function __construct(private string $directory,private string $worker,private Closure $security,private ?Closure $writer=null) {
        $directory=realpath($directory)?:throw new RuntimeException('Control directory missing.');
        $worker=realpath($worker)?:throw new RuntimeException('Worker identity missing.');
        $this->directory=$directory;$this->worker=$worker;
        ($this->security)($directory);
    }
    public function __destruct(){if(is_resource($this->lease)){flock($this->lease,LOCK_UN);fclose($this->lease);}}
    public static function windowsSecurity(string $directory): void {
        if(PHP_OS_FAMILY!=='Windows')throw new RuntimeException('Production control requires Windows ACL verification.');
        $path=base64_encode($directory);
        $script='$ErrorActionPreference="Stop"; $p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("'.$path.'")); '
            .'$item=Get-Item -LiteralPath $p; while($item){if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw "Reparse point"};$item=$item.Parent}; '
            .'$acl=Get-Acl -LiteralPath $p; if(-not $acl.AreAccessRulesProtected){throw "Inherited ACL"}; '
            .'$allowed=@([Security.Principal.WindowsIdentity]::GetCurrent().User.Value,"S-1-5-18","S-1-5-32-544"); '
            .'foreach($r in $acl.Access){if($r.AccessControlType -eq "Allow" -and $r.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin $allowed){throw "Broad ACL"}}; "ACL_OK"';
        $encoded=base64_encode(iconv('UTF-8','UTF-16LE',$script));$out=[];$code=1;
        exec('powershell.exe -NoProfile -NonInteractive -EncodedCommand '.$encoded.' 2>NUL',$out,$code);
        if($code!==0||trim(implode("\n",$out))!=='ACL_OK')throw new RuntimeException('Private control ACL could not be verified.');
    }
    private function file(string $name):string{return $this->directory.DIRECTORY_SEPARATOR.$name;}
    private function read(string $name):array {
        $path=$this->file($name);
        if(is_link($path)||!is_file($path)||filesize($path)>8192)throw new RuntimeException('Invalid control record.');
        $data=json_decode(file_get_contents($path),true,32,JSON_THROW_ON_ERROR);
        if(!is_array($data))throw new RuntimeException('Invalid control payload.');return $data;
    }
    private function publish(string $name,array $data):void {
        ($this->security)($this->directory);
        $path=$this->file($name);$json=json_encode($data,JSON_THROW_ON_ERROR|JSON_UNESCAPED_SLASHES);
        if(file_exists($path)){
            if($this->read($name)!==$data)throw new RuntimeException('Conflicting immutable control record.');return;
        }
        if($this->writer){($this->writer)($path,$json);}
        else {
            $temp=$path.'.'.bin2hex(random_bytes(8)).'.tmp';$h=fopen($temp,'xb');
            if(!$h)throw new RuntimeException('Control write failed.');
            try{if(fwrite($h,$json)!==strlen($json)||!fflush($h))throw new RuntimeException('Control write incomplete.');
                if(function_exists('fsync')&&!fsync($h))throw new RuntimeException('Control sync failed.');
            }finally{fclose($h);}
            // Serialized request writers; immutable destination is never replaced.
            if(file_exists($path)||!rename($temp,$path))throw new RuntimeException('Control publication uncertain.');
        }
        if($this->read($name)!==$data)throw new RuntimeException('Control readback failed.');
    }
    private function validIdentity(array $a):bool {
        return ($a['version']??null)===1 && ($a['worker']??null)===$this->worker &&
            is_string($a['instance']??null)&&preg_match('/^[a-f0-9]{32}$/D',$a['instance'])===1&&
            is_int($a['pid']??null)&&$a['pid']>0&&is_string($a['process_started']??null)&&$a['process_started']!=='';
    }
    public function start(string $started):array {
        $this->lease=fopen($this->file('worker.lock'),'c');
        if(!$this->lease||!flock($this->lease,LOCK_EX|LOCK_NB))throw new RuntimeException('Local worker already active.');
        // A persistent maintenance request must never be bypassed by a relaunch.
        if($this->blocked())throw new RuntimeException("Maintenance hold active; no database access permitted.");
        $this->instance=['version'=>1,'instance'=>bin2hex(random_bytes(16)),'pid'=>getmypid(),'process_started'=>$started,'worker'=>$this->worker];
        $this->publish($this->instance['instance'].'.instance.json',$this->instance);return $this->instance;
    }
    public function blocked():bool {
        ($this->security)($this->directory);
        if(!file_exists($this->file('maintenance.json')))return false;
        $request=$this->read('maintenance.json');$a=$request['target']??[];
        if(($request['version']??null)!==1||($request['action']??null)!=='stop'||!is_array($a)||!$this->validIdentity($a))throw new RuntimeException('Malformed maintenance request; fail closed.');
        if($this->read($a['instance'].'.instance.json')!==$a)throw new RuntimeException('Maintenance identity mismatch.');
        if($this->instance && $a!==$this->instance)throw new RuntimeException('Stop targets another instance; fail closed.');
        return true;
    }
    public function request(string $id):void {
        if(!preg_match('/^[a-f0-9]{32}$/D',$id))throw new RuntimeException('Exact instance ID required.');
        $h=fopen($this->file('request.lock'),'c');if(!$h||!flock($h,LOCK_EX))throw new RuntimeException('Request serialization failed.');
        try{
            $a=$this->read($id.'.instance.json');if(!$this->validIdentity($a))throw new RuntimeException('Invalid instance.');
            if(file_exists($this->file($id.'.exit.json')))throw new RuntimeException('Instance already exited.');
            $this->publish('maintenance.json',['version'=>1,'action'=>'stop','target'=>$a]);
        }finally{flock($h,LOCK_UN);fclose($h);}
    }
    public function receipt(string $reason,string $cleanup,int $code):void {
        if(!$this->instance)throw new RuntimeException('No registered instance.');
        $this->publish($this->instance['instance'].'.exit.json',['version'=>1,'target'=>$this->instance,'reason'=>$reason,'cleanup'=>$cleanup,'exit_code'=>$code]);
    }
}
