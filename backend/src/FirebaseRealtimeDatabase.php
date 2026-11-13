<?php
declare(strict_types=1);

interface DispenseCommandGateway
{
    public function sendDispenseCommand(int $requestId, int $slot, int $quantity): array;
    public function retireDispenseCommand(int $requestId): void;
}

interface TransactionReferenceGateway {
    public function syncTransactionReference(string $kind, int $transactionId, string $reference, ?int $requestId=null): void;
    public function sendReferencedDispenseCommand(int $requestId,int $slot,int $quantity,int $transactionId,string $reference): array;
}

interface DispenseRecoveryReadGateway {
    /** Read only: never changes a command or invents hardware state. */
    public function recoveryRetirementState(int $requestId): string;
}

final class FirebaseRealtimeDatabase implements DispenseCommandGateway, TransactionReferenceGateway, DispenseRecoveryReadGateway
{
    private string $databaseUrl;

    public function __construct(string $databaseUrl, private ?Closure $metadataTransport=null)
    {
        $databaseUrl = rtrim(trim($databaseUrl), '/');

        if ($databaseUrl === '') {
            throw new RuntimeException(
                'Firebase Realtime Database URL is not configured.'
            );
        }

        $this->databaseUrl = $databaseUrl;
    }

    /**
     * Send one complete dispensing command to Firebase.
     *
     * Slot: 1, 2, or 3
     * Quantity: 1, 2, or 3
     */
    public function sendDispenseCommand(int $requestId, int $slot, int $quantity): array
    {
        return $this->sendCommand($requestId,$slot,$quantity,[]);
    }

    public function sendReferencedDispenseCommand(int $requestId,int $slot,int $quantity,int $transactionId,string $reference): array {
        $identity=self::referenceIdentity('dispensing',$transactionId,$reference,$requestId);
        return $this->sendCommand($requestId,$slot,$quantity,$identity);
    }

    private function sendCommand(int $requestId,int $slot,int $quantity,array $identity): array
    {
        if ($requestId < 1) {
            throw new InvalidArgumentException('Request ID must be a positive integer.');
        }

        if ($slot < 1 || $slot > 3) {
            throw new InvalidArgumentException(
                'Slot must be between 1 and 3.'
            );
        }

        if ($quantity < 1 || $quantity > 3) {
            throw new InvalidArgumentException(
                'Quantity must be between 1 and 3.'
            );
        }

        $payload = [
            'request_id' => $requestId,
            'slot' => $slot,
            'quantity' => $quantity,
            'dispensed' => 0,
            'status' => 'pending',
        ];

        if(!$identity)return $this->put('/dispense',$payload);
        for($attempt=0;$attempt<3;$attempt++) {
            $read=$this->metadataRequest('GET','/dispense',null,['X-Firebase-ETag: true']);
            if($read['status']!==200 || empty($read['etag']))throw new RuntimeException('REFERENCE_SYNC_UNAVAILABLE');
            $existing=$read['data'];
            if($existing!==null && (!is_array($existing) || array_is_list($existing)))throw new RuntimeException('REFERENCE_IDENTITY_CONFLICT');
            if($existing!==null && ($existing['request_id']??null)===$requestId) {
                foreach($identity as $key=>$value)if(array_key_exists($key,$existing)&&$existing[$key]!==$value)throw new RuntimeException('REFERENCE_IDENTITY_CONFLICT');
                // Never reset an existing command's result/count/status on identity retry.
                return $existing;
            }
            if($existing!==null && in_array($existing['status']??'', ['pending','dispensing'],true))throw new RuntimeException('Another dispensing command is active; identity synchronization did not overwrite it.');
            $data=array_merge($payload,$identity);
            $written=$this->metadataRequest('PUT','/dispense',$data,['if-match: '.$read['etag']]);
            if($written['status']===412)continue;
            if($written['status']<200 || $written['status']>=300)throw new RuntimeException('REFERENCE_SYNC_UNAVAILABLE');
            return $data;
        }
        throw new RuntimeException('REFERENCE_SYNC_CONCURRENT_UPDATE');
    }

    public static function referenceIdentity(string $kind,int $transactionId,string $reference,?int $requestId=null): array {
        if(!in_array($kind,['payments','dispensing'],true) || $transactionId<1 || !preg_match('/^TXN-[A-Z0-9]{8,28}$/D',$reference) || ($kind==='dispensing' && (!$requestId || $requestId<1)))
            throw new InvalidArgumentException('Missing or invalid authoritative transaction identity.');
        $identity=['transaction_id'=>$transactionId,'transaction_reference'=>$reference];
        if($kind==='dispensing')$identity['request_id']=$requestId;
        return $identity;
    }

    /** Only identity metadata; never payment/status/result writes. ETags protect concurrent updates. */
    public function syncTransactionReference(string $kind,int $transactionId,string $reference,?int $requestId=null): void {
        $identity=self::referenceIdentity($kind,$transactionId,$reference,$requestId);
        $path='/transaction_tracking/'.$kind.'/'.($kind==='payments'?$transactionId:$requestId);
        for($attempt=0;$attempt<3;$attempt++) {
            $read=$this->metadataRequest('GET',$path,null,['X-Firebase-ETag: true']);
            if($read['status']!==200 || empty($read['etag']))throw new RuntimeException('REFERENCE_SYNC_UNAVAILABLE');
            $existing=$read['data'];
            if($existing!==null && (!is_array($existing) || array_is_list($existing)))throw new RuntimeException('REFERENCE_IDENTITY_CONFLICT');
            $existing??=[];
            foreach($identity as $key=>$value)if(array_key_exists($key,$existing)&&$existing[$key]!==$value)throw new RuntimeException('REFERENCE_IDENTITY_CONFLICT');
            if(count(array_intersect_key($existing,$identity))===count($identity))return;
            $written=$this->metadataRequest('PUT',$path,array_merge($existing,$identity),['if-match: '.$read['etag']]);
            if($written['status']===412)continue;
            if($written['status']<200||$written['status']>=300)throw new RuntimeException('REFERENCE_SYNC_UNAVAILABLE');
            return;
        }
        throw new RuntimeException('REFERENCE_SYNC_CONCURRENT_UPDATE');
    }

    private function metadataRequest(string $method,string $path,?array $data,array $headers,int $timeoutSeconds=10): array {
        if($this->metadataTransport)return ($this->metadataTransport)($method,$path,$data,$headers);
        $etag=null;$ch=curl_init($this->databaseUrl.$path.'.json');
        curl_setopt_array($ch,[CURLOPT_CUSTOMREQUEST=>$method,CURLOPT_RETURNTRANSFER=>true,CURLOPT_CONNECTTIMEOUT=>min(5,$timeoutSeconds),CURLOPT_TIMEOUT=>$timeoutSeconds,
            CURLOPT_HTTPHEADER=>array_merge(['Content-Type: application/json'],$headers),
            CURLOPT_HEADERFUNCTION=>static function($curl,string $line)use(&$etag):int{if(stripos($line,'ETag:')===0)$etag=trim(substr($line,5));return strlen($line);}]);
        if($data!==null)curl_setopt($ch,CURLOPT_POSTFIELDS,json_encode($data,JSON_THROW_ON_ERROR));
        $response=curl_exec($ch);$status=(int)curl_getinfo($ch,CURLINFO_HTTP_CODE);curl_close($ch);
        if($response===false)throw new RuntimeException('REFERENCE_SYNC_UNAVAILABLE');
        return ['status'=>$status,'etag'=>$etag,'data'=>json_decode($response,true,512,JSON_THROW_ON_ERROR)];
    }

    public function controllerReplacementState(): string {
        $current=$this->metadataRequest('GET','/dispense',null,[],3);
        if($current['status']!==200)return 'unverified';
        $command=$current['data'];
        if($command===null)return 'idle';
        if(!is_array($command)||array_is_list($command))return 'unverified';
        if(in_array($command['status']??'', ['pending','dispensing'],true))return 'active';
        return in_array($command['status']??'', ['success','failed'],true)?'idle':'unverified';
    }
    public function recoveryRetirementState(int $requestId): string {
        $current=$this->metadataRequest('GET','/dispense',null,[],3);
        if($current['status']!==200)return 'unverified';
        $command=$current['data'];
        if($command!==null&&(!is_array($command)||array_is_list($command)))return 'unverified';
        if($command!==null&&in_array($command['status']??'', ['pending','dispensing'],true))return 'active';
        if($command!==null&&!in_array($command['status']??'', ['success','failed'],true))return 'unverified';
        $result=$this->metadataRequest('GET','/dispense_results/'.$requestId,null,[],3);
        $receipt=$result['data'];
        return $result['status']===200 && is_array($receipt) && ($receipt['request_id']??null)===$requestId && ($receipt['status']??'')==='failed' && ($receipt['source']??'')==='admin_recovery'?'retired':'unverified';
    }

    /** Retire only the selected command. Never write a pending command here. */
    public function retireDispenseCommand(int $requestId): void
    {
        $etag = null;
        $ch = curl_init($this->databaseUrl . '/dispense.json');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => 10,
            CURLOPT_HTTPHEADER => ['X-Firebase-ETag: true'],
            CURLOPT_HEADERFUNCTION => static function ($curl, string $line) use (&$etag): int {
                if (stripos($line, 'ETag:') === 0) $etag = trim(substr($line, 5));
                return strlen($line);
            },
        ]);
        $response = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($response === false || $code !== 200 || !$etag) {
            throw new RuntimeException('Cannot verify Firebase command. Recovery was not completed; keep the controller disconnected.');
        }
        $command = json_decode($response, true, 512, JSON_THROW_ON_ERROR);
        if ($command !== null && !is_array($command)) throw new RuntimeException('Invalid Firebase command; recovery stopped.');
        if ($command !== null && (int)($command['request_id'] ?? 0) !== $requestId) {
            // Do not overwrite another request, including one currently pending.
            if (in_array($command['status'] ?? '', ['pending','dispensing'], true)) throw new RuntimeException('Another Firebase command is active. Keep the controller disconnected and reconcile that request first.');
        }
        if ($command !== null && (int)($command['request_id'] ?? 0) === $requestId) {
            $command['status'] = 'failed';
            $command['slot'] = 0;
            $command['quantity'] = 0;
            // Keep request_id and reported dispensed count for investigation.
            $this->put('/dispense', $command, ['if-match: ' . $etag]);
        }
        // Retain a request-specific terminal result even after /dispense is reused.
        // A failed write prevents the caller from committing or unlocking the kiosk.
        $this->put('/dispense_results/' . $requestId, [
            'request_id' => $requestId, 'status' => 'failed',
            'source' => 'admin_recovery', 'hardware_disabled_confirmed' => true,
        ]);
    }

    private function put(string $path, array $data, array $headers = []): array
    {
        if($this->metadataTransport) {
            $response=($this->metadataTransport)('PUT',$path,$data,$headers);
            if($response['status']<200 || $response['status']>=300)throw new RuntimeException('Firebase returned a non-success response.');
            return $response['data']??$data;
        }
        $url = $this->databaseUrl
            . '/'
            . ltrim($path, '/')
            . '.json';

        $json = json_encode(
            $data,
            JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR
        );

        $ch = curl_init($url);

        if ($ch === false) {
            throw new RuntimeException(
                'Could not initialize Firebase connection.'
            );
        }

        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST => 'PUT',
            CURLOPT_POSTFIELDS => $json,
            CURLOPT_HTTPHEADER => array_merge(['Content-Type: application/json'], $headers),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => 10,
        ]);

        $response = curl_exec($ch);

        if ($response === false) {
            $error = curl_error($ch);
            curl_close($ch);

            throw new RuntimeException(
                'Firebase request failed: ' . $error
            );
        }

        $statusCode = (int) curl_getinfo(
            $ch,
            CURLINFO_HTTP_CODE
        );

        curl_close($ch);

        if ($statusCode < 200 || $statusCode >= 300) {
            throw new RuntimeException(
                'Firebase returned HTTP ' . $statusCode . '.'
            );
        }

        $decoded = json_decode($response, true);

        return is_array($decoded) ? $decoded : $data;
    }
}
