SELECT
     cmp_cd
    ,site_cd
    ,TO_CHAR(recv_dt,'YYYYMMDDHH24MISS') AS recv_dt
    ,item_cd
    ,item_nm
    ,qty
FROM public.eai_sample
