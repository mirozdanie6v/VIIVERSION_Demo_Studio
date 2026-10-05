#!/usr/bin/env python3
import argparse, json, subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W,H=1080,1920
FPS=30
GRAPHITE=(8,8,9,255)

def sh(cmd):
    print("+"," ".join(map(str,cmd)),flush=True)
    subprocess.run(cmd,check=True)

def probe(path):
    return float(subprocess.check_output([
        "ffprobe","-v","error","-show_entries","format=duration","-of","csv=p=0",str(path)
    ],text=True).strip())

def find_font(weight="regular"):
    preferred="Inter" if weight=="regular" else "Inter SemiBold"
    try:
        value=subprocess.check_output(["fc-match","-f","%{file}",preferred],text=True).strip()
        if value and Path(value).exists(): return value
    except Exception:
        pass
    return "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf" if weight=="regular" else "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

FONT_REG=find_font("regular")
FONT_BOLD=find_font("bold")

def font(path,size):
    return ImageFont.truetype(path,size)

def make_bg():
    base=Image.new("RGBA",(W,H),GRAPHITE)
    glow=Image.new("RGBA",(W,H),(0,0,0,0))
    gd=ImageDraw.Draw(glow)
    gd.ellipse((-260,180,900,1380),fill=(255,128,52,38))
    gd.ellipse((430,1150,1210,2100),fill=(255,180,108,22))
    glow=glow.filter(ImageFilter.GaussianBlur(180))
    base=Image.alpha_composite(base,glow)
    noise=Image.effect_noise((W,H),16).convert("L")
    grain=Image.new("RGBA",(W,H),(255,255,255,0))
    grain.putalpha(noise.point(lambda p:max(0,min(14,int((p-128)*0.06+5)))))
    return Image.alpha_composite(base,grain)

def paste_phone(canvas,screenshot,box,radius=48):
    x,y,w,h=box
    shadow=Image.new("RGBA",(W,H),(0,0,0,0))
    sd=ImageDraw.Draw(shadow)
    sd.rounded_rectangle((x+10,y+18,x+w+10,y+h+24),radius=radius,fill=(0,0,0,150))
    shadow=shadow.filter(ImageFilter.GaussianBlur(26))
    canvas.alpha_composite(shadow)
    d=ImageDraw.Draw(canvas)
    d.rounded_rectangle((x,y,x+w,y+h),radius=radius,fill=(12,12,14,255),outline=(255,255,255,54),width=2)
    inset=12
    shot=Image.open(screenshot).convert("RGB").resize((w-2*inset,h-2*inset),Image.Resampling.LANCZOS)
    canvas.paste(shot,(x+inset,y+inset))
    d.rounded_rectangle((x+w//2-48,y+18,x+w//2+48,y+36),radius=10,fill=(3,3,4,245))

def make_intro(path, screenshot):
    canvas=make_bg()
    d=ImageDraw.Draw(canvas)
    d.text((72,112),"VIIVERSION  /  ПРЕЗЕНТАЦИЯ",font=font(FONT_BOLD,18),fill=(255,255,255,145))
    d.text((72,246),"MAX TOUR",font=font(FONT_BOLD,72),fill="white")
    d.text((72,342),"От выбора тура —",font=font(FONT_BOLD,44),fill=(245,245,245,244))
    d.text((72,402),"до подтверждённой оплаты.",font=font(FONT_BOLD,40),fill=(255,174,104,255))
    d.text((72,486),"Весь клиентский путь в одном приложении.",font=font(FONT_REG,27),fill=(230,230,232,196))
    d.text((72,540),"Экскурсии · AI-консультант · Бронирование · Оплата",font=font(FONT_REG,23),fill=(210,210,214,165))
    paste_phone(canvas,screenshot,(335,690,410,888),48)
    d.text((72,1805),"MAX TOUR × VIIVERSION",font=font(FONT_BOLD,20),fill=(255,255,255,125))
    canvas.save(path)

def make_outro(path, screenshot):
    canvas=make_bg()
    d=ImageDraw.Draw(canvas)
    d.text((72,112),"VIIVERSION  /  РЕЗУЛЬТАТ",font=font(FONT_BOLD,18),fill=(255,255,255,145))
    d.rounded_rectangle((72,220,350,278),radius=28,fill=(255,147,70,245),outline=(255,183,118,255),width=1)
    d.text((211,249),"ОПЛАТА ПОДТВЕРЖДЕНА",font=font(FONT_BOLD,17),fill=(255,255,255,255),anchor="mm")
    d.text((72,365),"Быстрее решение.",font=font(FONT_BOLD,44),fill="white")
    d.text((72,430),"Проще бронирование.",font=font(FONT_BOLD,44),fill="white")
    d.text((72,495),"Больше клиентов готовы купить.",font=font(FONT_BOLD,36),fill=(255,174,104,255))
    d.text((72,585),"Хотите так же для своего бизнеса?",font=font(FONT_REG,27),fill=(235,235,238,205))
    d.text((72,635),"Свяжитесь с VIIVERSION.",font=font(FONT_BOLD,30),fill=(255,255,255,235))
    paste_phone(canvas,screenshot,(585,760,350,758),46)
    d.text((72,1805),"MAX TOUR × VIIVERSION",font=font(FONT_BOLD,20),fill=(255,255,255,125))
    canvas.save(path)

def render_static(image,out,dur):
    sh(["ffmpeg","-loglevel","error","-y","-loop","1","-i",str(image),"-t",f"{dur:.3f}",
        "-r",str(FPS),"-an","-c:v","libx264","-preset","veryfast","-crf","19","-pix_fmt","yuv420p",str(out)])

def concat_video(parts,out):
    lst=Path(out).with_suffix(".txt")
    lst.write_text("\n".join([f"file '{Path(p).name}'" for p in parts])+"\n")
    sh(["ffmpeg","-loglevel","error","-y","-f","concat","-safe","0","-i",str(lst),"-c","copy",str(out)])

def ass_time(s):
    cs=max(0,round(s*100)); h=cs//360000; cs%=360000; m=cs//6000; cs%=6000
    return f"{h}:{m:02d}:{cs//100:02d}.{cs%100:02d}"

def wrap(text,limit=38):
    words=text.split(); lines=[]; cur=""
    for word in words:
        test=(cur+" "+word).strip()
        if not cur or len(test)<=limit: cur=test
        else: lines.append(cur); cur=word
    if cur: lines.append(cur)
    if len(lines)<=2: return r"\N".join(lines)
    half=max(1,len(words)//2)
    return " ".join(words[:half])+r"\N"+" ".join(words[half:])

def write_ass(path,starts,durations,payment_start):
    sections=[
      ("Весь путь — в одном приложении.",[
        "Выбрать экскурсию, получить ответы и оформить поездку — всё в одном мобильном приложении.",
        "MAX TOUR делает весь путь клиента понятным и цельным."
      ]),
      ("Найдите подходящую экскурсию.",[
        "Экскурсии, цены и ключевые детали видны сразу.",
        "Гость быстрее сравнивает варианты и понимает, что подходит именно ему."
      ]),
      ("Всё в одном контексте.",[
        "Фотографии, программа, формат, стоимость и важные детали собраны в одном месте.",
        "Интерес легче превращается в решение, пока клиент действительно вовлечён."
      ]),
      ("Спросите естественно.",[
        "Если появляется вопрос, его можно задать обычным человеческим языком.",
        "AI-консультант отвечает с учётом выбранной экскурсии и помогает двигаться дальше."
      ]),
      ("Следующий шаг понятен.",[
        "Меньше трения между интересом и бронированием.",
        "Клиент сразу возвращается к туру и продолжает."
      ]),
      ("Бронирование в одном потоке.",[
        "Участники, отель, данные туристов и оплата объединены в один последовательный сценарий.",
        "Клиент доходит до подтверждения, не покидая приложение."
      ])
    ]
    header="""[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Headline,Inter SemiBold,34,&H005CA6FF,&H005CA6FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,7,72,72,48,1
Style: Caption,Inter,38,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,8,76,76,118,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    events=[]
    for (headline,chunks),start,dur in zip(sections,starts,durations):
        events.append(f"Dialogue: 1,{ass_time(start)},{ass_time(start+min(1.35,dur))},Headline,,0,0,0,,{{\\fad(160,250)}}{headline}")
        weights=[max(1,len(x.replace(" ",""))) for x in chunks]
        total=sum(weights); cur=start
        for i,(chunk,w) in enumerate(zip(chunks,weights)):
            nxt=start+dur if i==len(chunks)-1 else cur+dur*w/total
            events.append(f"Dialogue: 2,{ass_time(cur)},{ass_time(nxt)},Caption,,0,0,0,,{wrap(chunk)}")
            cur=nxt
    events.append(f"Dialogue: 3,{ass_time(payment_start)},{ass_time(payment_start+1.55)},Headline,,0,0,0,,{{\\fad(160,280)}}Оплата подтверждена.")
    Path(path).write_text(header+"\n".join(events)+"\n",encoding="utf-8")

def build_voiceover(files,starts,cta_file,cta_start,out):
    all_files=list(files)+[cta_file]
    all_starts=list(starts)+[cta_start]
    cmd=["ffmpeg","-loglevel","error","-y"]
    for p in all_files: cmd += ["-i",str(p)]
    filters=[]; labels=[]
    for i,st in enumerate(all_starts):
        delay=round(st*1000)
        filters.append(f"[{i}:a]aresample=44100,adelay={delay}:all=1[v{i}]")
        labels.append(f"[v{i}]")
    filters.append("".join(labels)+f"amix=inputs={len(labels)}:duration=longest:normalize=0,alimiter=limit=0.95[voice]")
    cmd += ["-filter_complex",";".join(filters),"-map","[voice]","-c:a","pcm_s16le",str(out)]
    sh(cmd)

def make_sfx(out,total,starts,payment_start):
    cmd=["ffmpeg","-loglevel","error","-y","-f","lavfi","-i",f"anullsrc=r=44100:cl=stereo:d={total:.3f}"]
    filters=[]; labels=["[0:a]"]; idx=1
    for t in starts[1:]:
        cmd += ["-f","lavfi","-i","anoisesrc=color=pink:duration=0.16:r=44100"]
        filters.append(f"[{idx}:a]highpass=f=900,lowpass=f=5200,volume=0.012,afade=t=out:st=0.06:d=0.10,adelay={round(t*1000)}:all=1[s{idx}]")
        labels.append(f"[s{idx}]"); idx+=1
    for t in [starts[1]+0.7,starts[3]+0.6,payment_start+0.35]:
        cmd += ["-f","lavfi","-i","sine=frequency=920:duration=0.055:sample_rate=44100"]
        filters.append(f"[{idx}:a]volume=0.018,afade=t=out:st=0.025:d=0.03,adelay={round(t*1000)}:all=1[s{idx}]")
        labels.append(f"[s{idx}]"); idx+=1
    for freq,offset,vol in [(880,0,0.038),(1320,115,0.028)]:
        cmd += ["-f","lavfi","-i",f"sine=frequency={freq}:duration=0.34:sample_rate=44100"]
        filters.append(f"[{idx}:a]volume={vol},afade=t=out:st=0.08:d=0.26,adelay={round((payment_start+1.8)*1000)+offset}:all=1[s{idx}]")
        labels.append(f"[s{idx}]"); idx+=1
    filters.append("".join(labels)+f"amix=inputs={len(labels)}:duration=longest:normalize=0,atrim=duration={total:.3f}[out]")
    cmd += ["-filter_complex",";".join(filters),"-map","[out]","-c:a","pcm_s16le",str(out)]
    sh(cmd)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--prior",required=True)
    ap.add_argument("--voices",required=True)
    ap.add_argument("--music",required=True)
    ap.add_argument("--out",required=True)
    args=ap.parse_args()

    prior=Path(args.prior); out=Path(args.out); out.mkdir(parents=True,exist_ok=True)
    report=json.load(open(prior/"render-report.json",encoding="utf-8"))
    starts=[float(x["start"]) for x in report["sections"]]
    durations=[float(x["duration"]) for x in report["sections"]]
    content_end=float(report["contentEnd"])
    outro_dur=float(report["outroDuration"])
    payment_start=float(report["paymentStart"])
    total=content_end+outro_dur
    intro_dur=min(2.6,durations[0]*0.30)

    intro_img=out/"intro_ru.png"; make_intro(intro_img,prior/"home.png")
    outro_img=out/"outro_ru.png"; make_outro(outro_img,prior/"paid.png")
    intro_mp4=out/"intro_ru.mp4"; render_static(intro_img,intro_mp4,intro_dur)
    outro_mp4=out/"outro_ru.mp4"; render_static(outro_img,outro_mp4,outro_dur)
    mid=out/"middle.mp4"
    sh(["ffmpeg","-loglevel","error","-y","-ss",f"{intro_dur:.3f}","-to",f"{content_end:.3f}","-i",str(prior/"visual.mp4"),
        "-an","-c:v","libx264","-preset","veryfast","-crf","19","-pix_fmt","yuv420p",str(mid)])
    visual=out/"visual_ru.mp4"; concat_video([intro_mp4,mid,outro_mp4],visual)

    ass=out/"captions_ru.ass"; write_ass(ass,starts,durations,payment_start)

    voices=Path(args.voices)
    voice_files=[voices/f"{name}.mp3" for name in ["hook","catalog","tour","ai","choice","booking"]]
    cta=voices/"cta.mp3"
    voiceover=out/"voiceover_ru.wav"
    build_voiceover(voice_files,starts,cta,content_end+0.35,voiceover)
    sfx=out/"sound-design.wav"; make_sfx(sfx,total,starts,payment_start)

    final=out/"MAX_TOUR_Premium_Product_Film_RU_FINAL.mp4"
    fc=(
        f"[0:v]ass='{ass.as_posix()}'[v];"
        f"[1:a]volume=0.105,atrim=duration={total:.3f},asetpts=N/SR/TB[m];"
        f"[m][2:a]sidechaincompress=threshold=0.030:ratio=10:attack=12:release=320[duck];"
        f"[duck][2:a][3:a]amix=inputs=3:duration=longest:normalize=0,alimiter=limit=0.94[a]"
    )
    sh(["ffmpeg","-loglevel","error","-y","-i",str(visual),"-stream_loop","-1","-i",str(args.music),
        "-i",str(voiceover),"-i",str(sfx),"-filter_complex",fc,"-map","[v]","-map","[a]",
        "-t",f"{total:.3f}","-c:v","libx264","-preset","medium","-crf","18","-pix_fmt","yuv420p",
        "-c:a","aac","-b:a","192k","-movflags","+faststart",str(final)])

    qa=[1.4,12.8,24.0,38.0,51.0,payment_start+1.5,content_end+2.8]
    for t in qa:
        sh(["ffmpeg","-loglevel","error","-y","-ss",f"{t:.2f}","-i",str(final),"-frames:v","1",str(out/f"qa_{t:.1f}.png")])

    result={
      "duration":probe(final),
      "language":"ru",
      "voice":"premium female Russian",
      "subtitleSize":38,
      "cta":"Свяжитесь с VIIVERSION",
      "sourceVisualRun":37326495066
    }
    (out/"render-report-ru.json").write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps(result,ensure_ascii=False,indent=2))

if __name__=="__main__":
    main()
