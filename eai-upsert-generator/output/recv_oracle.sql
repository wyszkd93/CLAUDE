BEGIN
  UPDATE IF_SAMPLE SET
       RECV_DT = TO_DATE(:RECV_DT,'YYYYMMDDHH24MISS')
      ,ITEM_CD = :ITEM_CD
      ,ITEM_NM = :ITEM_NM
      ,QTY = :QTY
   WHERE CMP_CD = :CMP_CD AND SITE_CD = :SITE_CD;

  IF SQL%NOTFOUND THEN
    INSERT INTO IF_SAMPLE (
         CMP_CD
        ,SITE_CD
        ,RECV_DT
        ,ITEM_CD
        ,ITEM_NM
        ,QTY
    ) VALUES (
         :CMP_CD
        ,:SITE_CD
        ,TO_DATE(:RECV_DT,'YYYYMMDDHH24MISS')
        ,:ITEM_CD
        ,:ITEM_NM
        ,:QTY
    );
  END IF;
END;
