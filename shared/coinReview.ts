export interface CoinReviewStatus {
  enabled:boolean;
  attestation:null|{nonce:string;device_id:string;age_seconds:number;created_at:string;payload:{event_id:string;transaction_id:number;bound_transaction_id:number;pulses:number;amount:number;count:number;quiet:number;healthy:number;binding_stable:number;overflow:number;requires_review:number}};
  reviews:{id:string;device_id:string;event_id:string;transaction_id:number;decision:string;created_at:string;expires_at:string;acknowledged_at:string|null}[];
}
