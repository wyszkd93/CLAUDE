INSERT INTO public.eai_recv_sample (
     cmp_cd
    ,site_cd
    ,recv_dt
    ,item_cd
    ,item_nm
    ,qty
) VALUES (
     :CMP_CD
    ,:SITE_CD
    ,TO_TIMESTAMP(:RECV_DT,'YYYYMMDDHH24MISS')
    ,:ITEM_CD
    ,:ITEM_NM
    ,:QTY
) ON CONFLICT (cmp_cd, site_cd) DO UPDATE SET
     cmp_cd                     = EXCLUDED.cmp_cd
    ,site_cd                    = EXCLUDED.site_cd
    ,recv_dt                    = EXCLUDED.recv_dt
    ,item_cd                    = EXCLUDED.item_cd
    ,item_nm                    = EXCLUDED.item_nm
    ,qty                        = EXCLUDED.qty
