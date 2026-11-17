INSERT INTO public.eai_sample (
     cmp_cd
    ,site_cd
    ,recv_dt
    ,item_cd
    ,item_nm
    ,qty
) VALUES (
     :CMP_CD
    ,:SITE_CD
    ,STR_TO_DATE(:RECV_DT,'%Y%m%d%H%i%s')
    ,:ITEM_CD
    ,:ITEM_NM
    ,:QTY
) ON DUPLICATE KEY UPDATE
     recv_dt                    = VALUES(recv_dt)
    ,item_cd                    = VALUES(item_cd)
    ,item_nm                    = VALUES(item_nm)
    ,qty                        = VALUES(qty)
