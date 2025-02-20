import { Context, Schema, Session, h } from 'koishi'
import { cartoon } from './bangumis'
import crypto from 'crypto'
import { } from 'koishi-plugin-monetary'
import path from 'path'
import fs from 'fs'
import { pathToFileURL } from 'url'
import { Readable } from 'node:stream'

export const name = 'smmcat-picguesscartoon'

export interface Config { debug: boolean, basePath: string }

export const inject = ['monetary'];
export const Config: Schema<Config> = Schema.object({
  basePath: Schema.string().default('./data/guessCartoon').description('图片文件存放位置'),
  debug: Schema.boolean().default(false).description('日志查看更多内容')
})

export function apply(ctx: Context, config: Config) {

  const guessCartoon = {
    CartoonDict: {},
    CartoonNameList: [],
    userTemp: {},
    optionsDict: { 'A': 0, 'B': 1, 'C': 2, 'D': 3, 'E': 4, 'F': 5, 'G': 6, 'H': 7, 'I': 8 },
    // 数据初始化
    init() {
      const temp = {}
      let total = 0
      JSON.parse(JSON.stringify(cartoon)).forEach((item) => {
        total += item[1].length
        temp[item[0]] = item[1]
      })
      this.CartoonDict = temp
      this.CartoonNameList = Object.keys(temp)
      console.log(`初始化猜动画内容数据完成，一共录入有 ${cartoon.length} 部动画。${total} 张截图`);
    },
    /** 制作题目 */
    async createTopic() {
      const menuList = getFreeList(this.CartoonNameList).slice(0, random(5, 7))
      const correctItem = menuList[random(0, menuList.length)]
      const pic = this.CartoonDict[correctItem][random(0, this.CartoonDict[correctItem].length)]
      return {
        options: menuList,
        success: correctItem,
        pic: await this.setStoreForImage(pic) || 'https://smmcat.cn/run/err.png'
      }
    },
    /** 下载图片到本地 */
    async setStoreForImage(imageUrl: string, type = 'png'): Promise<string | null> {
      const setPath = path.join(ctx.baseDir, config.basePath)
      if (!fs.existsSync(setPath)) {
        fs.mkdirSync(setPath, { recursive: true });
      }
      const timestamp = new Date().getTime();
      const imagePath = path.join(setPath, `${timestamp}.${type}`);
      const response = await ctx.http.get(imageUrl, { responseType: 'stream' });
      const writer = fs.createWriteStream(imagePath);
      const responseNodeStream = Readable.fromWeb(response)
      responseNodeStream.pipe(writer);

      return await new Promise((resolve, reject) => {
        writer.on('finish', () => {
          config.debug && console.log(`下载完成，文件路径 ${imagePath}`);
          resolve(pathToFileURL(imagePath).href)
        });
        writer.on('error', () => {
          reject('')
        });
      });
    },
    /** 显示题目 */
    showFormat(item: { options: string[], success: string, pic: string }) {
      config.debug && console.log(item);

      const dict = Object.keys(this.optionsDict)
      return `${h.image(item.pic)}` + `看图猜动漫，回复你认为动漫出处的下方序号即可：\n${item.options.map((i, index) => `${dict[index]}. 《${i}》`).join('\n')}`
    },
    async createPlay(session: Session<"id">) {
      if (this.userTemp[session.userId]) return
      await session.send('进入限时1分钟快速答题环节，题目为10道题。请稍等...')
      const startTime = +new Date()
      this.userTemp[session.userId] = {
        startTime,
        total: 0,
        right: 0,
        mistake: 0,
        topicLen: 1
      }
      const rewardRules = { 8: 2, 5: 3, 2: 5 };

      let topic = await guessCartoon.createTopic()
      let upTime = startTime
      let dict = Object.keys(guessCartoon.optionsDict).slice(0, topic.options.length)
      let next = false
      let upStatus = true
      while (+new Date() - startTime < 60000 || this.userTemp[session.userId].topicLen <= 10) {
        try {
          // 下一题
          if (next) {
            next = false
            upStatus = true
            topic = await guessCartoon.createTopic()
            dict = Object.keys(guessCartoon.optionsDict).slice(0, topic.options.length)
            this.userTemp[session.userId].topicLen++

          }
          // 播报题目
          await session.send(this.showFormat(topic) + '\n' +
            `当前为第${this.userTemp[session.userId].topicLen}题；请直接回答正确的序号，如需退出请发送 退出`);
          config.debug && console.log(`剩余时间:${60000 - (+new Date() - startTime)}`);
          if (upStatus) {
            upTime = +new Date()
          }
          const select = await session.prompt(60000 - (+new Date() - startTime))

          if (!select) {
            break;
          }

          // 用户选择退出
          if (select && select.toLocaleUpperCase().trim() == '退出') {
            break;
          }
          config.debug && console.log(`选择的答案：` + select, `可用选项：` + dict);


          // 用户正确作答
          if (select && dict.includes(select.toLocaleUpperCase().trim())) {
            next = true
            // 获取选中的回答
            const reply = topic.options[this.optionsDict[select.toLocaleUpperCase().trim()]]
            const _useTime = Math.floor((+new Date() - upTime) / 1000)
            // 进行判断
            if (reply === topic.success) {
              const points = Number(Object.keys(rewardRules).find((item) => Number(item) > _useTime) || 1)
              this.userTemp[session.userId].total += points
              this.userTemp[session.userId].right++
              session.send(`回答正确，答案为：《${topic.success}》\n用时${_useTime}秒，获得积分：${points}\n当前积分：${this.userTemp[session.userId].total}`)
            } else {
              if (select) {
                this.userTemp[session.userId].total -= 3
                if (this.userTemp[session.userId].total < 0) {
                  this.userTemp[session.userId].total = 0
                }
                this.userTemp[session.userId].mistake++
                session.send(`回答错误，答案为：《${topic.success}》\n用时${_useTime}秒，扣除积分：3\n当前积分：${this.userTemp[session.userId].total}`)
              }
            }
          } else {
            if (select) {
              await session.send(`操作有误，请直接回答序号，例如 A~${dict[dict.length - 1]}`)
            }
          }
        } catch (error) {
          session.send('出错，下一题')
          next = true
        }
      }
      await session.send('答题结束，正在结算。公布结果')
      const userItem = this.userTemp[session.userId]

      // 撰写评价
      let tip = { msg: [], pic: '' }
      if (userItem.topicLen == 3) {
        tip = totalMsg.no[random(0, totalMsg.no.length)]
      } else if (userItem.topicLen >= 10 && userItem.mistake == 0) {
        tip = totalMsg.good[random(0, totalMsg.good.length)]
        tip.msg = ["居然全对，厉害厉害！", "不愧是你啊，全部正确", "太棒了！全对，100昏"]
      } else if (userItem.right >= 6 && userItem.right / userItem.topicLen > 0.7) {
        tip = totalMsg.good[random(0, totalMsg.good.length)]
      } else if (userItem.right / userItem.topicLen >= 0.4) {
        tip = totalMsg.bad[random(0, totalMsg.bad.length)]
      } else {
        tip = totalMsg.lost[random(0, totalMsg.lost.length)]
      }

      await session.send(`${h.image(tip.pic)}` + `\n${tip.msg[random(0, tip.msg.length)]}\n`
        + `总答题数：${userItem.topicLen}\n用时：${Math.floor((+new Date - startTime) / 1000)}秒\n答对数：${userItem.right}\n答错数：${userItem.mistake}\n得分：${userItem.total}`)
      await ctx.monetary.gain(session.user.id, userItem.total)
      delete guessCartoon.userTemp[session.userId]
    }
  }

  const totalMsg = {
    good: [
      {
        msg: ["是个二刺螈", "这些题目真的~超~简单~的", "哼，不过如此", "不愧是我"],
        pic: 'https://smmcat.cn/run/katong/good.png'
      },
      {
        msg: ["是个二刺螈", "这些题目真的~超~简单~的", "可以可以，打的不错", "不愧是你"],
        pic: 'https://smmcat.cn/run/katong/good2.png'
      },
      {
        msg: ["这些题目能再难点吗", "我超会答的", "居然这么简单的过了", "不愧是我"],
        pic: 'https://smmcat.cn/run/katong/good3.png'
      }
    ],
    lost: [
      {
        msg: ["还得继续努力啊...", "厨艺不精"],
        pic: 'https://smmcat.cn/run/katong/lost.png'
      },
      {
        msg: ["还得继续努力啊...", "厨艺不精", "继续努力嗯"],
        pic: 'https://smmcat.cn/run/katong/lost2.png'
      },
      {
        msg: ["还得咋继续努力？", "厨艺不佳", "你的失败是因为看的番少了"],
        pic: 'https://smmcat.cn/run/katong/lost3.png'
      }
    ],
    bad: [
      {
        msg: ["假二刺螈居然是...", "不及格，该罚"],
        pic: 'https://smmcat.cn/run/katong/bad.png'
      },
      {
        msg: ["完了，混入了一个假二刺螈", "这得分，我该说什么？"],
        pic: 'https://smmcat.cn/run/katong/bad2.png'
      },
      {
        msg: ["假二刺螈居然是...", "不及格，该罚", "垫底居然是我"],
        pic: 'https://smmcat.cn/run/katong/bad3.png'
      }
    ],
    no: [
      {
        msg: ["不要半途而废啊！", "中途退出不是什么好习惯嗯", "要坚持啊！"],
        pic: 'https://smmcat.cn/run/katong/no2.png'
      },
      {
        msg: ["不要半途而废啊！", "中途退出不是什么好习惯嗯", "要坚持啊！"],
        pic: 'https://smmcat.cn/run/katong/no2.png'
      },
      {
        msg: ["不要半途而废啊！", "中途退出不是什么好习惯嗯", "要坚持啊！"],
        pic: 'https://smmcat.cn/run/katong/no3.png'
      }
    ]
  }

  ctx
    .command('截图猜动画').userFields(["id"])
    .action(async ({ session }) => {
      await guessCartoon.createPlay(session)
    })

  ctx.on('ready', () => {
    guessCartoon.init()
  })
  function random(min, max) {
    const randomBuffer = crypto.randomBytes(4);
    const randomNumber = randomBuffer.readUInt32LE(0) / 0x100000000;
    return Math.floor(min + randomNumber * (max - min));
  }
  // 打乱数组
  function getFreeList(arr) {
    let arrAdd = [...arr];
    for (let i = 1; i < arrAdd.length; i++) {
      const random = Math.floor(Math.random() * (i + 1));
      //交换两个数组
      [arrAdd[i], arrAdd[random]] = [arrAdd[random], arrAdd[i]];
    }
    return arrAdd;
  }
} 
