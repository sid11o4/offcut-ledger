-- B2 (DP-152F2D) past board consumption: use the sheet rates.
update past_material_consumption set unit_cost = 2880
 where id = '2caa241e-937e-42a6-84a5-aaa4647a95bd' and unit_cost = 2720;  -- 16MM HDHMR x11 = 31,680
update past_material_consumption set unit_cost = 2650
 where id = '90ee860a-be10-409c-873b-39fdfc6142d2' and unit_cost = 2350;  -- 107 FWN x5 = 13,250
