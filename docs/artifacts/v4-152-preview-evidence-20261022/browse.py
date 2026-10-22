#!/usr/bin/env python3
import sys
sys.dont_write_bytecode=True
from capture import run,ROOT
AB=['agent-browser','--session','qa152']
def click(name):return run('click-'+name,AB+['find','role','button','click','--name',name,'--exact'])
def capture(name):
 run(name+'-desktop-size',AB+['set','viewport','1440','1000'])
 run(name+'-desktop-tree',AB+['snapshot'])
 run(name+'-desktop-shot',AB+['screenshot',str(ROOT/'shots'/(name+'-desktop.png'))])
 run(name+'-mobile-size',AB+['set','viewport','390','844'])
 run(name+'-mobile-tree',AB+['snapshot'])
 run(name+'-mobile-shot',AB+['screenshot',str(ROOT/'shots'/(name+'-mobile.png'))])
 run(name+'-reset-size',AB+['set','viewport','1440','1000'])
if __name__=='__main__':
 click('a2d2-dev/dsh-plugin 仓库')
 capture('03-repo-overview-cache')
 click('刷新来源')
 run('repo-refresh-wait',AB+['wait','--load','networkidle'])
 capture('04-repo-overview-refresh')
 for page,num in [('Issue','06'),('PR','07')]:
  click(page)
  run('repo-'+page+'-wait',AB+['wait','--load','networkidle'])
  capture(num+'-repo-'+{'项目':'projects','Issue':'issues','PR':'prs'}[page])
