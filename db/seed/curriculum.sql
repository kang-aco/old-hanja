-- 커리큘럼 난이도 — scripts/build-curriculum.mjs 가 생성합니다. 직접 고치지 마십시오.
--
-- 자동 산출 40건 중 5건은 사람이 확정한 보정값입니다.
-- 등급을 바꾸려면 이 파일이 아니라 스크립트의 OVERRIDES 를 고치고 다시 돌리십시오.
-- 보정 이유가 그 자리에 주석으로 남아 있어야 나중에 근거를 다시 찾을 수 있습니다.
--
-- 기준: 한자 수 0.40 · 글자 희귀도 0.35 · 문법 부담 0.25 (자세한 설명은 스크립트 주석)

UPDATE passages SET difficulty = 1, hanja_count = 9, curriculum_order = 1 WHERE passage = '學而時習之, 不亦說乎';
UPDATE passages SET difficulty = 1, hanja_count = 4, curriculum_order = 2 WHERE passage = '過猶不及';
UPDATE passages SET difficulty = 1, hanja_count = 4, curriculum_order = 3 WHERE passage = '先憂後樂';
UPDATE passages SET difficulty = 1, hanja_count = 4, curriculum_order = 4 WHERE passage = '日就月將';
UPDATE passages SET difficulty = 1, hanja_count = 4, curriculum_order = 5 WHERE passage = '上善若水';
UPDATE passages SET difficulty = 1, hanja_count = 5, curriculum_order = 6 WHERE passage = '見賢思齊焉';
UPDATE passages SET difficulty = 2, hanja_count = 4, curriculum_order = 1 WHERE passage = '結草報恩';
UPDATE passages SET difficulty = 2, hanja_count = 5, curriculum_order = 2 WHERE passage = '欲速則不達';
UPDATE passages SET difficulty = 2, hanja_count = 6, curriculum_order = 3 WHERE passage = '克己復禮爲仁';
UPDATE passages SET difficulty = 2, hanja_count = 4, curriculum_order = 4 WHERE passage = '大器晩成';
UPDATE passages SET difficulty = 2, hanja_count = 4, curriculum_order = 5 WHERE passage = '鋸木不折';
UPDATE passages SET difficulty = 2, hanja_count = 4, curriculum_order = 6 WHERE passage = '靑出於藍';
UPDATE passages SET difficulty = 2, hanja_count = 8, curriculum_order = 7 WHERE passage = '三人行, 必有我師焉';
UPDATE passages SET difficulty = 2, hanja_count = 7, curriculum_order = 8 WHERE passage = '朝聞道, 夕死可矣';
UPDATE passages SET difficulty = 2, hanja_count = 4, curriculum_order = 9 WHERE passage = '唇亡齒寒';
UPDATE passages SET difficulty = 2, hanja_count = 8, curriculum_order = 10 WHERE passage = '物有本末, 事有終始';
UPDATE passages SET difficulty = 2, hanja_count = 9, curriculum_order = 11 WHERE passage = '修身齊家治國平天下';
UPDATE passages SET difficulty = 2, hanja_count = 10, curriculum_order = 12 WHERE passage = '知之爲知之, 不知爲不知';
UPDATE passages SET difficulty = 3, hanja_count = 8, curriculum_order = 1 WHERE passage = '知彼知己, 百戰不殆';
UPDATE passages SET difficulty = 3, hanja_count = 8, curriculum_order = 2 WHERE passage = '得道多助, 失道寡助';
UPDATE passages SET difficulty = 3, hanja_count = 5, curriculum_order = 3 WHERE passage = '兵者, 詭道也';
UPDATE passages SET difficulty = 3, hanja_count = 8, curriculum_order = 4 WHERE passage = '千里之行, 始於足下';
UPDATE passages SET difficulty = 3, hanja_count = 8, curriculum_order = 5 WHERE passage = '知人者智, 自知者明';
UPDATE passages SET difficulty = 3, hanja_count = 8, curriculum_order = 6 WHERE passage = '民惟邦本, 本固邦寧';
UPDATE passages SET difficulty = 3, hanja_count = 8, curriculum_order = 7 WHERE passage = '生於憂患, 死於安樂';
UPDATE passages SET difficulty = 3, hanja_count = 8, curriculum_order = 8 WHERE passage = '性相近也, 習相遠也';
UPDATE passages SET difficulty = 3, hanja_count = 10, curriculum_order = 9 WHERE passage = '富貴不能淫, 貧賤不能移';
UPDATE passages SET difficulty = 3, hanja_count = 8, curriculum_order = 10 WHERE passage = '己所不欲, 勿施於人';
UPDATE passages SET difficulty = 3, hanja_count = 8, curriculum_order = 11 WHERE passage = '如切如磋, 如琢如磨';
UPDATE passages SET difficulty = 4, hanja_count = 8, curriculum_order = 1 WHERE passage = '他人有心, 予忖度之';
UPDATE passages SET difficulty = 4, hanja_count = 10, curriculum_order = 2 WHERE passage = '有朋自遠方來, 不亦樂乎';
UPDATE passages SET difficulty = 4, hanja_count = 12, curriculum_order = 3 WHERE passage = '不患人之不己知, 患不知人也';
UPDATE passages SET difficulty = 4, hanja_count = 12, curriculum_order = 4 WHERE passage = '君子和而不同, 小人同而不和';
UPDATE passages SET difficulty = 4, hanja_count = 10, curriculum_order = 5 WHERE passage = '喜怒哀樂之未發, 謂之中';
UPDATE passages SET difficulty = 4, hanja_count = 12, curriculum_order = 6 WHERE passage = '天時不如地利, 地利不如人和';
UPDATE passages SET difficulty = 4, hanja_count = 9, curriculum_order = 7 WHERE passage = '博學之, 審問之, 愼思之';
UPDATE passages SET difficulty = 4, hanja_count = 10, curriculum_order = 8 WHERE passage = '溫故而知新, 可以爲師矣';
UPDATE passages SET difficulty = 5, hanja_count = 10, curriculum_order = 1 WHERE passage = '吾生也有涯, 而知也無涯';
UPDATE passages SET difficulty = 5, hanja_count = 11, curriculum_order = 2 WHERE passage = '人不知而不慍, 不亦君子乎';
UPDATE passages SET difficulty = 5, hanja_count = 12, curriculum_order = 3 WHERE passage = '學而不思則罔, 思而不學則殆';
