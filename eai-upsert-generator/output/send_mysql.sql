SELECT
     cmp_cd
    ,site_cd
    ,DATE_FORMAT(recv_dt,'%Y%m%d%H%i%s') AS recv_dt
    ,item_cd
    ,item_nm
    ,qty
FROM public.eai_sample
